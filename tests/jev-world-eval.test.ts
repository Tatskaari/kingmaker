import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artifactFileName,
  summarizeJevEval,
  writeJevEvalArtifact,
  type JevEvalRun,
  type JevWorldEvalScenario,
} from "../packages/evals/src/jev-world-eval.js";

const run = (success: boolean, turns: number): JevEvalRun => ({ success, turns,
  terminalChoice: success ? "complete" : "unable", trace: [], transcripts: [],
  finalSnapshot: { scenario: {}, gameMasterHistory: [], conversations: {} },
  ...(success ? {} : { reason: "The requested world state was not reached." }) });
test("Jev eval summaries separate successful and failed turn counts", () => {
  const summary = summarizeJevEval("Treasury", [run(true, 4), run(false, 12), run(true, 6), run(false, 16)]);
  assert.equal(summary.successes, 2); assert.equal(summary.failures, 2); assert.equal(summary.successRate, 0.5);
  assert.equal(summary.averageSuccessTurns, 5); assert.equal(summary.averageFailureTurns, 14);
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
