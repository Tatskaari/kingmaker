import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { guestIds, inviteGuests, silkScarf } from "../evals/jev/scenarios.js";
import {
  artifactFileName,
  runJevEvalOnce,
  summarizeJevEval,
  writeJevEvalArtifact,
  type JevEvalRun,
  type JevWorldEvalScenario,
} from "../packages/evals/src/jev-world-eval.js";

const run = (success: boolean, turns: number): JevEvalRun => ({ success, turns,
  terminalChoice: success ? "complete" : "unable", trace: [], transcripts: [], talkCalls: [],
  finalSnapshot: { scenario: {}, gameMasterHistory: [], conversations: {} },
  ...(success ? {} : { reason: "The requested world state was not reached." }) });
test("Jev eval summaries separate successful and failed turn counts", () => {
  const summary = summarizeJevEval("Treasury", [run(true, 4), run(false, 12), run(true, 6), run(false, 16)]);
  assert.equal(summary.successes, 2); assert.equal(summary.failures, 2); assert.equal(summary.successRate, 0.5);
  assert.equal(summary.averageSuccessTurns, 5); assert.equal(summary.averageFailureTurns, 14);
});

test("minimal eval sends the text interface without character background or recent results", async t => {
  let observed: unknown;
  t.mock.method(JevClient.prototype, "choose", async (state: unknown) => {
    observed = state;
    return { choice: "complete", probabilities: {} };
  });
  const result = await runJevEvalOnce(silkScarf, "test", true);
  assert.equal(result.error, undefined);
  assert.equal(result.minimal, true);
  assert.equal(typeof observed, "string");
  assert.match(observed as string, /Great Hall/);
  assert.match(observed as string, /fetch the silk scarf/);
  assert.doesNotMatch(observed as string, /Biography|Relationships|Recent results|Parked objectives/);
});

test("mocked talks cover every guest, feed planner history, and leave recipients in place on fresh runs", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Dialogue must be mocked"); });
  t.mock.method(JevClient.prototype, "choose", async (state: { recentActions: string[] }) => {
    const target = guestIds[state.recentActions.length];
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
