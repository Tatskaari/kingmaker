import assert from "node:assert/strict";
import test from "node:test";
import { createLiveConversationExperiment } from "../packages/evals/src/live-conversation-experiment.js";
import { oswinParlourCase } from "../packages/evals/src/oswin-parlour-case.js";
import { RunRecording } from "../packages/evals/src/experiment.js";
import { Recording, type ServiceCall } from "../packages/service-tools/src/recording.js";
import { loadPlayableWorld } from "./fixtures.js";

test("live judge receives original docs edits and accepted dialogue, without added world evidence", async () => {
  const world = loadPlayableWorld();
  const accepted = [{ role: "assistant", content: "Accepted replacement" }];
  const edits: ServiceCall[] = [{ id: 2, service: "docs", method: "replace", args: ["note.md", "sha", "old", "new"],
    startedAt: "test", outcome: { status: "returned", value: { path: "note.md", sha: "updated", text: "new" } } },
  { id: 3, service: "docs", method: "commit", args: [[{ path: "activity.md", expectedSha: null, text: "Activity" }]],
    startedAt: "test", outcome: { status: "threw", error: "Conflict" } }];
  const recording = new RunRecording([
    { id: 1, service: "docs", method: "read", args: ["unrelated.md"], startedAt: "test", outcome: { status: "returned", value: "UNRELATED_READ" } },
    ...edits,
    { id: 4, service: "scenario", method: "snapshot", args: [], startedAt: "test", outcome: { status: "returned", value: "FULL_WORLD" } },
    { id: 5, service: "debug", method: "record", args: [{ source: "accepted-transcript", output: accepted }], startedAt: "test" },
  ], world, world);
  let judged = false;
  const experiment = createLiveConversationExperiment(oswinParlourCase, () => { throw new Error("No execution expected"); }, {
    decisions: async (evidence, questions) => {
      judged = true;
      assert.deepEqual(evidence, { transcript: accepted, participants: oswinParlourCase.participants,
        characterId: oswinParlourCase.characterId, expectations: oswinParlourCase.expectations, error: undefined, updates: edits });
      assert.doesNotMatch(JSON.stringify(evidence), /UNRELATED_READ|FULL_WORLD|contextDocuments|beforeIntent|physicalState/);
      return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "complete", probabilities: { complete: 1 } }]));
    },
  });
  const result = await experiment.score(recording, { signal: new AbortController().signal, recording: new Recording() });
  assert.ok(judged);
  assert.equal(result.criteria["physical-state"]?.score, 1);
});
