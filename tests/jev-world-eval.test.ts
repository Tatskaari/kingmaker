import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fromJson } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { guestIds, inviteGuests, silkScarf, royalSeal } from "../evals/jev/scenarios.js";
import {
  artifactFileName,
  runJevEvalOnce,
  summarizeJevEval,
  scoreJevAssessment,
  writeJevEvalArtifact,
  type JevEvalRun,
  type JevWorldEvalScenario,
} from "../packages/evals/src/jev-world-eval.js";

const run = (success: boolean, turns: number): JevEvalRun => ({ success, turns,
  ...scoreJevAssessment({ success }),
  terminalChoice: success ? "complete" : "unable", trace: [], transcripts: [], talkCalls: [],
  finalSnapshot: { scenario: {}, gameMasterHistory: [], conversations: {} },
  ...(success ? {} : { reason: "The requested world state was not reached." }) });
test("Jev eval summaries separate successful and failed turn counts", () => {
  const summary = summarizeJevEval("Treasury", [run(true, 4), run(false, 12), run(true, 6), run(false, 16)]);
  assert.equal(summary.successes, 2); assert.equal(summary.failures, 2); assert.equal(summary.successRate, 0.5);
  assert.equal(summary.averageSuccessTurns, 5); assert.equal(summary.averageFailureTurns, 14);
});

test("royal seal milestones award progress without credit for untouched closures", () => {
  const scenario = fromJson(ScenarioSchema, royalSeal.createRuntime("test").snapshot().scenario);
  const assess = (completedActionIds: string[]) => scoreJevAssessment(royalSeal.evaluate({
    scenario, completedActionIds, terminalChoice: "limit", talkCalls: [],
  }));
  assert.equal(assess([]).score, 0);
  assert.equal(assess(["take_palace_royal_key"]).score, 2);
  const opened = assess(["take_palace_royal_key", "open_palace_coffer_03"]);
  assert.equal(opened.score, 4);
  assert.equal(opened.maxScore, 11);
  scenario.world!.objects.find(item => item.id === "palace_royal_seal")!.locationId = "king";
  assert.equal(assess(["take_palace_royal_key", "open_palace_coffer_03"]).score, 7);
  const summary = summarizeJevEval("Progress", [{ ...run(false, 12), ...opened }, { ...run(false, 24), ...assess([]) }]);
  assert.equal(summary.score, 6);
  assert.equal(summary.maxScore, 22);
  assert.equal(summary.scoreRate, 6 / 22);
  assert.equal(summary.successes, 0);
});

test("minimal eval includes the action log without character background", async t => {
  let observed: unknown;
  let decisions = 0;
  t.mock.method(JevClient.prototype, "choose", async (state: unknown) => {
    observed = state;
    return { choice: decisions++ === 0 ? "enter_royal_council_chamber" : "complete", probabilities: {} };
  });
  const result = await runJevEvalOnce(silkScarf, "test", true);
  assert.equal(result.error, undefined);
  assert.equal(result.minimal, true);
  assert.equal(typeof observed, "string");
  assert.match(observed as string, /Great Hall/);
  assert.match(observed as string, /fetch the silk scarf/);
  assert.match(observed as string, /Action log \(completed actions, oldest first\):/);
  assert.match(observed as string, /Action log[^]*\nenter_royal_council_chamber/);
  assert.doesNotMatch(observed as string, /Biography|Relationships|Recent results|Parked objectives/);
});

test("the authored royal-seal objective reaches minimal Jev without a generated status", async t => {
  let observed: unknown;
  t.mock.method(JevClient.prototype, "choose", async (state: unknown) => {
    observed = state;
    return { choice: "unable", probabilities: {} };
  });
  const result = await runJevEvalOnce(royalSeal, "test", true);
  assert.equal(result.error, undefined);
  assert.equal(typeof observed, "string");
  for (const text of [royalSeal.goal, ...Object.values(royalSeal.objective!)]) {
    assert.ok((observed as string).includes(text));
  }
  assert.doesNotMatch(observed as string, /Eval task\. Next:/);
});

test("mocked talks cover every guest, feed planner history, and leave recipients in place on fresh runs", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Dialogue must be mocked"); });
  t.mock.method(JevClient.prototype, "choose", async (state: string) => {
    const completed = state.split("Action log (completed actions, oldest first):\n")[1]!;
    const target = guestIds.filter(id => !completed.split("\n").includes(`talk_${id}`))[0];
    return { choice: target ? `talk_${target}` : "complete", probabilities: {} };
  });
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await runJevEvalOnce(inviteGuests, "test");
    assert.equal(result.error, undefined);
    assert.equal(result.success, true);
    assert.equal(result.turns, 10);
    assert.deepEqual(result.talkCalls.map(call => call.targetId), guestIds);
    const world = (result.finalSnapshot.scenario as any).world;
    for (const id of guestIds) assert.equal(world.actors.find((actor: any) => actor.characterId === id).roomId, "great_hall");
  }
});

test("repeating one guest cannot satisfy coverage", async t => {
  t.mock.method(JevClient.prototype, "choose", async () => ({ choice: "talk_mara", probabilities: {} }));
  const result = await runJevEvalOnce({ ...inviteGuests, maxTurns: 2 }, "test");
  assert.equal(result.success, false);
  assert.equal(result.terminalChoice, "limit");
  assert.equal(result.talkCalls.length, 2);
  assert.match(result.reason!, /Guests not contacted: hadrik/);
});
test("scarf eval stops and scores the talk target without running conversation", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Conversation must not run"); });
  for (const target of ["rowan", "mara"]) {
    let decisions = 0;
    const mock = t.mock.method(JevClient.prototype, "choose", async () => {
      assert.equal(++decisions, 1, "Stop immediately at the talk call");
      return { choice: `talk_${target}`, probabilities: {} };
    });
    const result = await runJevEvalOnce(silkScarf, "test");
    assert.equal(result.error, undefined);
    assert.equal(result.success, target === "rowan");
    assert.equal(result.turns, 1);
    assert.equal(result.terminalChoice, "requires_conversation");
    assert.deepEqual(result.talkCalls.map(call => call.targetId), [target]);
    mock.mock.restore();
  }
});
test("Jev eval artifacts include the invocation date, scenario and run", () => {
  assert.equal(artifactFileName(new Date("2026-10-01T14:05:00.000Z"), "Enter the Treasury and close the door", 3),
    "2026-10-01T14-05-00Z--enter-the-treasury-and-close-the-door--run-03.json");
});

test("Jev eval artifacts preserve the run transcript", () => {
  const directory = mkdtempSync(join(tmpdir(), "kingmaker-jev-eval-"));
  const definition: JevWorldEvalScenario = {
    name: "Treasury",
    characterId: "corvin",
    goal: "Wait in the Treasury.",
    createRuntime() { throw new Error("Not used by this test."); },
    evaluate() { return { success: true }; },
  };
  const result = run(true, 4);
  result.transcripts.push({
    id: 1,
    kind: "jev",
    characterId: "corvin",
    startedAt: "2026-10-01T14:05:00.000Z",
    status: "success",
    request: { state: "before" },
    response: { choice: "complete" },
  });
  try {
    const path = writeJevEvalArtifact(directory, new Date("2026-10-01T14:05:00.000Z"), definition, 1, result);
    const artifact = JSON.parse(readFileSync(path, "utf8")) as { scenario: { name: string }; run: number; transcripts: unknown[] };
    assert.equal(artifact.scenario.name, "Treasury");
    assert.equal(artifact.run, 1);
    assert.deepEqual(artifact.transcripts, result.transcripts);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
