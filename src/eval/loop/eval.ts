/**
 * The GM loop's eval: each case's turn played again from its fixture, on each variant, a few
 * samples each, and judged by the rubric. Every sample is its own process (a variant's prompts
 * and settings are its environment, and a sample's calls are its own log):
 *
 * <rounds>/evals/<stamp>[-label]/
 *   run.json                                  the commit, the variants, the cases, the samples, the judge
 *   samples/<variant>/<case>/<n>/result.json  the reply, the judgement, pass or fail, cost
 *                               calls.jsonl   the turn's own model calls
 *                               judge.jsonl   the judge's call
 *   samples/recorded/<case>/0/                the judge on the reply as recorded (does the eval see the failure?)
 *
 * Sample 0 keeps the game's own dice seed, so it rolls what the game rolled; the others reseed.
 * Variants get the same seeds sample for sample.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../../scenes/index.ts";
import { setCallLog } from "../../llm/openrouter.ts";
import { approachById } from "../../runtime/approaches.ts";
import { playerTurn } from "../../runtime/engine.ts";
import { applyRepair, runRepair } from "../../runtime/repair.ts";
import type { Entry, SessionState } from "../../runtime/session.ts";
import { loadFixture, readCase, type LoopCase } from "./fixture.ts";
import { judgeReply, type Judgement } from "./judge.ts";
import { CASES_DIR, ROOT, runsRoot } from "./paths.ts";
import { turnText } from "./review.ts";
import { build, loadVariant, variantEnv, type Variant } from "./round.ts";

export interface EvalRun {
  name: string; created: string; build: { commit: string; dirty: boolean };
  variants: Record<string, Variant>; cases: string[]; samples: number; judge: string;
}

export interface SampleResult {
  case: string; variant: string; sample: number; ok: boolean; error?: string;
  seed?: number; reply?: string; entries?: Entry[];
  moves?: SessionState["path"]; rulings?: SessionState["rulings"];
  judgement?: Judgement; turnCostUsd?: number; firstTextMs?: number | null;
}

export const evalsRoot = () => join(runsRoot(), "evals");
export const sampleDir = (run: string, variant: string, id: string, n: number) => join(run, "samples", variant, id, String(n));

/** The cases: every one under evals/loop/cases, or those named, or those with a tag. */
export function selectCases(ids?: string[], tags?: string[]): LoopCase[] {
  const all = existsSync(CASES_DIR) ? readdirSync(CASES_DIR).filter(d => existsSync(join(CASES_DIR, d, "case.json"))).map(d => readCase(join(CASES_DIR, d))) : [];
  return all.filter(c => (!ids || ids.some(id => c.id === id || c.id.startsWith(id))) && (!tags || tags.some(t => c.tags?.includes(t))));
}

// ---------------------------------------------------------------------------------------------
// One sample (in a process of its own)

export async function runSample(spec: { run: string; variant: string; case: string; sample: number }): Promise<void> {
  const dir = sampleDir(spec.run, spec.variant, spec.case, spec.sample);
  mkdirSync(dir, { recursive: true });
  process.env.KM_RUNS_DIR = join(dir, "runs");
  const caseDir = join(CASES_DIR, spec.case);
  const c = readCase(caseDir);
  const recorded = spec.variant === "recorded";
  const variant = recorded ? undefined : loadVariant(spec.variant);
  const baseSeed = (JSON.parse(readFileSync(join(caseDir, "state.json"), "utf8")) as { seed: number }).seed;
  const seed = spec.sample === 0 ? baseSeed : baseSeed + spec.sample * 7919;
  const out: SampleResult = { case: c.id, variant: spec.variant, sample: spec.sample, ok: false, seed };
  try {
    const state = loadFixture(caseDir, { id: `${c.id}-${spec.variant}-${spec.sample}`, seed, ...(variant?.approach ? { approach: variant.approach } : {}) });
    const before = structuredClone(state);
    if (recorded) {
      out.reply = c.observed.reply;
    } else {
      setCallLog(join(dir, "calls.jsonl"));
      const scene = sceneById(state.sceneId);
      const approach = approachById(state.approach);
      // fresh: today's co-GM looks at the scene before the turn, as it would have between turns.
      if (c.harness === "fresh" && approach.repair !== "off") applyRepair(scene, state, await runRepair(scene, state, { effort: approach.repairEffort ?? "medium" }));
      const result = await playerTurn(state, c.input);
      const produced = result.entries.filter(e => e.kind !== "player");
      Object.assign(out, {
        reply: turnText(state, produced, { player: false }), entries: produced,
        moves: state.path.filter(p => p.turn === state.turn), rulings: (state.rulings ?? []).filter(r => r.turn === state.turn),
        turnCostUsd: result.metric.costUsd, firstTextMs: result.metric.firstTextMs ?? null,
      });
    }
    setCallLog(join(dir, "judge.jsonl"));
    out.judgement = await judgeReply(c, before, out.reply!);
    out.ok = true;
  } catch (error) {
    out.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  }
  writeFileSync(join(dir, "result.json"), JSON.stringify(out, null, 1));
}

// ---------------------------------------------------------------------------------------------
// The run

async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i]!(); }
  }));
  return results;
}

function child(spec: { run: string; variant: string; case: string; sample: number }, env: Record<string, string>): Promise<void> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ["--no-warnings", join(ROOT, "src", "eval", "loop", "cli.ts"), "sample", JSON.stringify(spec)], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", d => { err += String(d); });
    p.on("close", code => {
      const file = join(sampleDir(spec.run, spec.variant, spec.case, spec.sample), "result.json");
      if (code !== 0 && !existsSync(file)) {
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, JSON.stringify({ case: spec.case, variant: spec.variant, sample: spec.sample, ok: false, error: `exit ${code}: ${err.slice(-2000)}` }, null, 1));
      }
      const r = JSON.parse(readFileSync(file, "utf8")) as SampleResult;
      console.log(`${spec.variant.padEnd(14)} ${spec.case} #${spec.sample}: ${!r.ok ? `ERROR ${r.error?.split("\n")[0]}` : r.judgement!.pass ? "pass" : `FAIL ${r.judgement!.findings.filter(f => f.severity >= 3).map(f => `${f.check}:${f.severity}`).join(" ") || "(criterion)"}`}`);
      resolve();
    });
  });
}

export async function runEval(options: { cases: LoopCase[]; variants: string[]; samples?: number; label?: string; concurrency?: number; recorded?: boolean }): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const name = `${stamp}${options.label ? `-${options.label}` : ""}`;
  const run = join(evalsRoot(), name);
  mkdirSync(run, { recursive: true });
  const variants = Object.fromEntries(options.variants.map(v => [v, loadVariant(v)]));
  const meta: EvalRun = {
    name, created: new Date().toISOString(), build: build(), variants, cases: options.cases.map(c => c.id),
    samples: options.samples ?? 0, judge: `${process.env.KM_JUDGE_MODEL ?? "openai/gpt-6-luna"} (${process.env.KM_JUDGE_EFFORT ?? "high"})`,
  };
  writeFileSync(join(run, "run.json"), JSON.stringify(meta, null, 1));
  const tasks: Array<() => Promise<void>> = [];
  if (options.recorded !== false) for (const c of options.cases) tasks.push(() => child({ run, variant: "recorded", case: c.id, sample: 0 }, {}));
  for (const c of options.cases) {
    const n = options.samples ?? c.samples;
    for (let s = 0; s < n; s++) for (const v of options.variants) tasks.push(() => child({ run, variant: v, case: c.id, sample: s }, variantEnv(variants[v]!)));
  }
  await pool(tasks, options.concurrency ?? 6);
  return run;
}

/**
 * A run judged again with today's rubric and criteria, with no GM calls: a new run beside it, the
 * same replies and the same calls (copied), a new judgement. For tuning a criterion or the rubric
 * until it calls the replies the way a careful reader would.
 */
export async function rejudge(from: string, options: { label?: string } = {}): Promise<string> {
  const src = existsSync(join(from, "run.json")) ? from : join(evalsRoot(), from);
  const meta = JSON.parse(readFileSync(join(src, "run.json"), "utf8")) as EvalRun;
  const name = `${meta.name}-rejudged${options.label ? `-${options.label}` : ""}-${new Date().toISOString().replace(/[-:]/g, "").slice(9, 15)}`;
  const run = join(evalsRoot(), name);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "run.json"), JSON.stringify({ ...meta, name, judge: `${process.env.KM_JUDGE_MODEL ?? "openai/gpt-6-luna"} (${process.env.KM_JUDGE_EFFORT ?? "high"}), rejudged from ${meta.name}` }, null, 1));
  const tasks = results(src).filter(r => r.ok && r.reply).map(r => async () => {
    const c = readCase(join(CASES_DIR, r.case));
    const dir = sampleDir(run, r.variant, r.case, r.sample);
    mkdirSync(dir, { recursive: true });
    const old = sampleDir(src, r.variant, r.case, r.sample);
    if (existsSync(join(old, "calls.jsonl"))) writeFileSync(join(dir, "calls.jsonl"), readFileSync(join(old, "calls.jsonl")));
    const before = loadFixture(join(CASES_DIR, r.case), { id: `${r.case}-${r.variant}-${r.sample}-rejudge` });
    const out: SampleResult = { ...r };
    try {
      setCallLog(join(dir, "judge.jsonl"));
      out.judgement = await judgeReply(c, before, r.reply!);
    } catch (error) { out.ok = false; out.error = error instanceof Error ? error.message : String(error); }
    writeFileSync(join(dir, "result.json"), JSON.stringify(out, null, 1));
    console.log(`${r.variant.padEnd(14)} ${r.case} #${r.sample}: ${r.judgement?.pass ? "pass" : "FAIL"} → ${out.judgement?.pass ? "pass" : "FAIL"}`);
  });
  // The judge's calls share one log at a time: one sample after another keeps each to its own file.
  process.env.KM_RUNS_DIR = join(run, "runs");
  for (const t of tasks) await t();
  return run;
}

/** Every sample's result in a run. */
export function results(run: string): SampleResult[] {
  const out: SampleResult[] = [];
  const root = join(run, "samples");
  if (!existsSync(root)) return out;
  for (const v of readdirSync(root)) for (const c of readdirSync(join(root, v))) for (const n of readdirSync(join(root, v, c))) {
    const file = join(root, v, c, n, "result.json");
    if (existsSync(file)) out.push(JSON.parse(readFileSync(file, "utf8")) as SampleResult);
  }
  return out.sort((a, b) => a.case.localeCompare(b.case) || a.variant.localeCompare(b.variant) || a.sample - b.sample);
}
