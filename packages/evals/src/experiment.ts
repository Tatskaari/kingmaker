import { type ConversationRuntime } from "../../conversation/src/runtime.js";
import type { ReviewLabels } from "../../conversation/src/review.js";
import { createRecordedRuntime, type EvalRuntimeOptions } from "./runtime.js";
import { Recording, type ServiceCall } from "../../service-tools/src/recording.js";

export interface RuntimeConfig<Labels = Record<string, never>, Review = ReviewLabels> {
  name: string;
  /** Fresh service factories and strategy hooks for every trial. */
  configure(): EvalRuntimeOptions<Labels, Review> | Promise<EvalRuntimeOptions<Labels, Review>>;
}
export interface ScoreLevel { score: number; description: string }
export interface Criterion { name: string; description: string; weight?: number; levels?: Record<string, ScoreLevel> }
export interface CriterionScore { score: number; reason?: string; probabilities?: Record<string, number> }
export interface Result { criteria: Record<string, CriterionScore> }
export class RunRecording {
  constructor(readonly calls: readonly ServiceCall[], readonly initialState: unknown, readonly finalState: unknown, readonly error?: unknown) {}
  getCalls() { return structuredClone(this.calls); }
  getServiceRecord(name: string) { return this.getCalls().filter(call => call.service === name); }
}
export interface ScoreContext { signal: AbortSignal; recording: Recording }
export interface Experiment<Labels = Record<string, never>, Review = ReviewLabels> {
  name: string;
  rubric: readonly Criterion[];
  getBaseline(): RuntimeConfig<Labels, Review>;
  getVariants(): readonly RuntimeConfig<Labels, Review>[];
  run(runtime: ConversationRuntime<Labels, Review>, signal: AbortSignal): Promise<void>;
  summarise(recording: RunRecording): string;
  score(recording: RunRecording, context: ScoreContext): Promise<Result>;
}
export interface Trial {
  experiment: string;
  variant: string;
  baseline: boolean;
  repeat: number;
  summary: string;
  recording: RunRecording;
  gradingCalls: ServiceCall[];
  result?: Result;
  scoringError?: unknown;
}
export interface RunOptions {
  repeats?: number;
  variants?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  onTrial?: (trial: Trial) => void | Promise<void>;
}

/** Also bounds hooks that accidentally ignore cancellation; each trial has isolated state. */
async function bounded<T>(action: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Trial timed out after ${timeoutMs}ms`)), timeoutMs);
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  let abort: () => void = () => {};
  try {
    signal.throwIfAborted();
    return await Promise.race([Promise.resolve().then(() => action(signal)), new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

export function validateRubric(rubric: readonly Criterion[]) {
  if (!rubric.length || new Set(rubric.map(item => item.name)).size !== rubric.length
    || rubric.some(item => !item.name.trim() || !Number.isFinite(item.weight ?? 1) || (item.weight ?? 1) <= 0)) {
    throw new Error("Rubric requires unique nonempty criterion names and positive finite weights.");
  }
  for (const criterion of rubric) if (criterion.levels && (!Object.keys(criterion.levels).length
    || Object.entries(criterion.levels).some(([name, level]) => !name.trim() || !level.description.trim()
      || !Number.isFinite(level.score) || level.score < 0 || level.score > 1))) {
    throw new Error("Rubric score levels require names, descriptions and scores between 0 and 1.");
  }
}
export function validateResult(result: Result, rubric: readonly Criterion[]) {
  if (!result?.criteria || Object.keys(result.criteria).length !== rubric.length || rubric.some(({ name }) =>
    !Object.hasOwn(result.criteria, name) || !Number.isFinite(result.criteria[name]?.score)
    || result.criteria[name]!.score < 0 || result.criteria[name]!.score > 1)) {
    throw new Error("Scores must include exactly the rubric criteria, each between 0 and 1.");
  }
}

/** Executes baseline and variants against fresh services; judges see evidence, never variant names. */
export async function runExperiment<L, R>(experiment: Experiment<L, R>, options: RunOptions = {}): Promise<Trial[]> {
  const repeats = options.repeats ?? 3, timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) throw new Error("repeats must be between 1 and 100");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be positive");
  validateRubric(experiment.rubric);
  const baseline = experiment.getBaseline(), configs = [baseline, ...experiment.getVariants()];
  if (configs.some(config => !config.name.trim()) || new Set(configs.map(config => config.name)).size !== configs.length) {
    throw new Error("Runtime configuration names must be unique and nonempty.");
  }
  for (const name of options.variants ?? []) if (!configs.some(config => config.name === name)) throw new Error(`Unknown variant: ${name}`);
  const selected = configs.filter(config => config === baseline || !options.variants || options.variants.includes(config.name));
  const trials: Trial[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) for (const config of selected) {
    options.signal?.throwIfAborted();
    const recording = new Recording(options.secrets), grading = new Recording(options.secrets);
    let initialState: unknown, finalState: unknown, error: unknown;
    let snapshot: (() => unknown) | undefined;
    try {
      await bounded(async signal => {
        const setup = await config.configure();
        signal.throwIfAborted();
        const runtime = createRecordedRuntime(setup, recording);
        if (setup.services?.scenario) snapshot = () => runtime.services.scenario.snapshot();
        initialState = recording.snapshot(snapshot?.());
        await experiment.run(runtime, signal);
      }, timeoutMs, options.signal);
    } catch (cause) { error = recording.snapshot(cause); }
    try { finalState = recording.snapshot(snapshot?.()); }
    catch (cause) { error ??= recording.snapshot(cause); }
    const evidence = new RunRecording(recording.getCalls(), initialState, finalState, error);
    const trial: Trial = { experiment: experiment.name, variant: config.name, baseline: config === baseline, repeat,
      summary: "", recording: evidence, gradingCalls: [] };
    try { trial.summary = String(recording.snapshot(experiment.summarise(evidence))); }
    catch (cause) { trial.summary = `Summary failed: ${JSON.stringify(recording.snapshot(cause))}`; }
    try {
      trial.result = await bounded(signal => experiment.score(evidence, { signal, recording: grading }), timeoutMs, options.signal);
      validateResult(trial.result, experiment.rubric);
      trial.result = grading.snapshot(trial.result) as Result;
    } catch (cause) { delete trial.result; trial.scoringError = grading.snapshot(cause); }
    trial.gradingCalls = grading.getCalls();
    trials.push(trial);
    await options.onTrial?.(trial);
    options.signal?.throwIfAborted();
  }
  return trials;
}
