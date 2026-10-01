import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { ActiveObjectiveSchema, ScenarioSchema, type Scenario } from "../../contracts/src/index.js";
import type { ModelTranscript } from "../../../apps/web/src/model-transcripts.js";
import { BrowserGameRuntime, type RuntimeSnapshot } from "../../../apps/web/src/runtime.js";

export interface JevEvalAssessment { success: boolean; reason?: string }
export interface JevTalkCall { characterId: string; targetId: string; actionId: string; goal: string; turn: number }
export interface JevWorldEvalScenario {
  name: string; characterId: string; goal: string; repeats?: number; maxTurns?: number;
  objective?: { name: string; status: string; successCriteria: string };
  createRuntime(apiKey: string): BrowserGameRuntime;
  mockTalk?: (call: JevTalkCall) => string;
  evaluate(result: { scenario: Scenario; terminalChoice: string; talkCalls: JevTalkCall[] }): JevEvalAssessment;
}
export interface JevEvalTraceEntry { turn: number; choice: string; action?: string; confidence?: number }
export interface JevEvalRun extends JevEvalAssessment {
  turns: number; terminalChoice: string; trace: JevEvalTraceEntry[]; transcripts: ModelTranscript[];
  finalSnapshot: RuntimeSnapshot; talkCalls: JevTalkCall[]; minimal?: boolean; error?: string;
}
export interface JevEvalSummary {
  name: string; runs: JevEvalRun[]; successes: number; failures: number; successRate: number;
  averageSuccessTurns?: number; averageFailureTurns?: number;
}

function activateGoal(runtime: BrowserGameRuntime, definition: JevWorldEvalScenario): void {
  const { characterId, goal, objective } = definition;
  const snapshot = runtime.snapshot(), scenario = fromJson(ScenarioSchema, snapshot.scenario);
  const character = scenario.characters.find(candidate => candidate.id === characterId);
  if (!character) throw new Error(`Unknown eval character: ${characterId}`);
  character.currentGoal = goal;
  character.activeObjective = create(ActiveObjectiveSchema, {
    name: objective?.name ?? goal.split(".")[0]!, status: objective?.status ?? `Eval task. Next: ${goal}`,
    successCriteria: objective?.successCriteria ?? "The requested physical state exists in the world.", currentGoal: goal,
  });
  snapshot.scenario = toJson(ScenarioSchema, scenario, { alwaysEmitImplicit: true });
  snapshot.npcActivities = { ...snapshot.npcActivities, [characterId]: { status: "active", goal, history: [] } };
  runtime.restore(snapshot);
}

export async function runJevEvalOnce(definition: JevWorldEvalScenario, apiKey: string, minimal = false): Promise<JevEvalRun> {
  let runtime = definition.createRuntime(apiKey);
  if (minimal) {
    const snapshot = runtime.snapshot();
    runtime = new BrowserGameRuntime(fromJson(ScenarioSchema, snapshot.scenario), apiKey, snapshot,
      undefined, undefined, undefined, true, { level: 1, includeRecentResults: false });
  }
  const trace: JevEvalTraceEntry[] = [];
  const talkCalls: JevTalkCall[] = [];
  let terminalChoice = "limit", error: string | undefined;
  try {
    activateGoal(runtime, definition);
    const signal = new AbortController().signal;
    for (let turn = 1; turn <= (definition.maxTurns ?? 24); turn++) {
      const plan = await runtime.planNpc(definition.characterId, signal);
      trace.push({ turn, choice: plan.decision.choice,
        ...(plan.action ? { action: plan.action.description } : {}),
        ...(plan.decision.confidence === undefined ? {} : { confidence: plan.decision.confidence }) });
      if (["complete", "wait", "unable"].includes(plan.decision.choice)) {
        terminalChoice = plan.decision.choice;
        runtime.finishNpcRun(definition.characterId, terminalChoice as "complete" | "wait" | "unable", JSON.stringify(plan.decision), plan.generations);
        break;
      }
      if (!plan.action) { terminalChoice = "invalid_action"; break; }
      let expected = plan.generations;
      while (true) {
        const step = runtime.stepNpcAction(definition.characterId, plan.action.id, plan.goal, expected);
        expected = step.generations;
        if (step.talkTarget) {
          const call = { characterId: definition.characterId, targetId: step.talkTarget,
            actionId: plan.action.id, goal: plan.goal, turn };
          talkCalls.push(call);
          if (!definition.mockTalk) { terminalChoice = "requires_conversation"; break; }
          const response = definition.mockTalk(call);
          // Give the planner feedback without invoking dialogue or moving the recipient.
          const snapshot = runtime.snapshot();
          snapshot.npcActivities![definition.characterId]!.history.push(response);
          runtime.restore(snapshot);
          break;
        }
        if (step.done) break;
      }
      if (terminalChoice === "requires_conversation") break;
    }
  } catch (cause) {
    terminalChoice = "error";
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const finalSnapshot = runtime.snapshot(), scenario = fromJson(ScenarioSchema, finalSnapshot.scenario);
  let assessment: JevEvalAssessment;
  try {
    assessment = error ? { success: false, reason: error } : definition.evaluate({ scenario, terminalChoice, talkCalls });
  } catch (cause) {
    assessment = { success: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
  return { ...assessment, turns: trace.length, terminalChoice, trace, talkCalls, minimal,
    transcripts: runtime.recentTranscripts().filter(entry => entry.kind === "jev").reverse(), finalSnapshot,
    ...(error === undefined ? {} : { error }) };
}

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}
export function summarizeJevEval(name: string, runs: JevEvalRun[]): JevEvalSummary {
  const successful = runs.filter(run => run.success), failed = runs.filter(run => !run.success);
  return { name, runs, successes: successful.length, failures: failed.length,
    successRate: runs.length ? successful.length / runs.length : 0,
    ...(successful.length ? { averageSuccessTurns: mean(successful.map(run => run.turns))! } : {}),
    ...(failed.length ? { averageFailureTurns: mean(failed.map(run => run.turns))! } : {}) };
}
export async function runJevEval(definition: JevWorldEvalScenario, apiKey: string,
  onRun?: (run: JevEvalRun, runNumber: number) => void, minimal = false): Promise<JevEvalSummary> {
  const runs: JevEvalRun[] = [];
  for (let index = 0; index < (definition.repeats ?? 10); index++) {
    const run = await runJevEvalOnce(definition, apiKey, minimal); runs.push(run); onRun?.(run, index + 1);
  }
  return summarizeJevEval(definition.name, runs);
}
export function artifactFileName(startedAt: Date, scenarioName: string, runNumber: number): string {
  const timestamp = startedAt.toISOString().replaceAll(":", "-").replace(".000Z", "Z");
  const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${timestamp}--${slug || "scenario"}--run-${String(runNumber).padStart(2, "0")}.json`;
}
export function writeJevEvalArtifact(outputDirectory: string, startedAt: Date, definition: JevWorldEvalScenario,
  runNumber: number, run: JevEvalRun): string {
  mkdirSync(outputDirectory, { recursive: true });
  const path = join(outputDirectory, artifactFileName(startedAt, definition.name, runNumber));
  writeFileSync(path, JSON.stringify({ recordedAt: new Date().toISOString(),
    scenario: { name: definition.name, characterId: definition.characterId, goal: definition.goal }, run: runNumber,
    minimal: run.minimal ?? false,
    success: run.success, turns: run.turns, terminalChoice: run.terminalChoice, reason: run.reason, error: run.error,
    trace: run.trace, talkCalls: run.talkCalls, transcripts: run.transcripts, finalSnapshot: run.finalSnapshot }, null, 2) + "\n");
  return path;
}
