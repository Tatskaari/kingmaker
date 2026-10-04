import assert from "node:assert/strict";
import test from "node:test";
import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { createReviewExperiment, documentChanges } from "../packages/evals/src/review-experiment.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { defaultWorldStrategies } from "../apps/web/src/world-strategies.js";
import { commitReview, loadPlayableWorld } from "./fixtures.js";
import transcript from "../evals/reviews/oswin-parlour.json" with { type: "json" };

test("review experiments replay real tools, record AI and docs, and grade state without variant identity", async () => {
  const source = loadPlayableWorld();
  const experiment = createReviewExperiment({ name: "oswin", characterId: "oswin", participants: ["oswin", "player"],
    transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)), expectations: "Go to the parlour.", loadWorld: () => source,
  }, [{ name: "candidate" }], () => ({
    responses: async () => commitReview({ summary: "Reviewed", newNotes: ["The player ordered me to the parlour."], activeGoal: "Go to the parlour." }),
    decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "skip", probabilities: { [key]: 0, skip: 1 } }])),
  }), { decisions: async (state, questions) => {
    const evidence = state as { changes: unknown[]; updates: unknown[]; contextDocuments: unknown[] };
    assert.ok(evidence.changes.length >= 2); assert.ok(evidence.updates.length >= 1); assert.ok(evidence.contextDocuments.length >= 2);
    assert.doesNotMatch(JSON.stringify(evidence), /"variant":|"candidate"/);
    return Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "pass", probabilities: { pass: 1, fail: 0, uncertain: 0 } }]));
  } });
  assert.equal((await experiment.getBaseline().configure()).strategies!.setup, defaultWorldStrategies.setup);
  const trials = await runExperiment(experiment, { repeats: 1 });
  for (const trial of trials) {
    assert.equal(trial.recording.error, undefined, JSON.stringify(trial.recording.error));
    assert.equal(trial.scoringError, undefined, JSON.stringify(trial.scoringError));
    assert.equal(trial.result!.criteria["physical-state"]!.score, 1);
    assert.ok(trial.recording.getServiceRecord("docs").some(call => call.method === "commit"));
    assert.ok(trial.recording.getServiceRecord("ai").some(call => call.method === "responses"));
    assert.ok(trial.recording.getServiceRecord("ai").some(call => call.method === "decisions"));
    assert.equal(trial.gradingCalls.filter(call => call.service === "ai").length, 1);
    assert.ok(documentChanges(trial.recording).some(change => change.after?.body.includes("ordered me")));
  }
  assert.deepEqual(documentChanges(trials[0]!.recording), documentChanges(trials[1]!.recording));
  assert.ok(!Object.values(source.docs).some(doc => doc.body.includes("The player ordered me to the parlour.")));
});
