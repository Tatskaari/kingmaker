import assert from "node:assert/strict";
import test from "node:test";
import { createReviewExperiment } from "../packages/evals/src/review-experiment.js";
import { oswinParlourCase } from "../packages/evals/src/oswin-parlour-case.js";
import { RunRecording } from "../packages/evals/src/experiment.js";
import { Recording, type ServiceCall } from "../packages/service-tools/src/recording.js";
import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { loadPlayableWorld } from "./fixtures.js";

test("review judge receives final touched files once, excluding intermediate and failed writes", async () => {
  const world = loadPlayableWorld();
  const final = clone(WorldStateSchema, world);
  const path = world.runtimeCharacters.oswin!.document;
  final.docs[path]!.body += "\nFINAL MEMORY";
  const deleted = "deleted.md";
  world.docs[deleted] = structuredClone(world.docs[path]!);
  const untouchedWrite = world.runtimeCharacters.peregrine!.document;
  const edits: ServiceCall[] = [{ id: 2, service: "docs", method: "replace", args: [path, "sha", "old", "INTERMEDIATE MEMORY"],
    startedAt: "test", outcome: { status: "returned", value: { path: "note.md", sha: "updated", text: "INTERMEDIATE MEMORY" } } },
  { id: 3, service: "docs", method: "commit", args: [[{ path: "activity.md", expectedSha: null, text: "Activity" }]],
    startedAt: "test", outcome: { status: "threw", error: "Conflict" } }];
  const recording = new RunRecording([
    { id: 1, service: "docs", method: "read", args: ["unrelated.md"], startedAt: "test", outcome: { status: "returned", value: "UNRELATED_READ" } },
    ...edits,
    { id: 6, service: "docs", method: "commit", args: [[{ path, text: "FINAL MEMORY" }, { path: untouchedWrite, text: "unchanged" }]], startedAt: "test", outcome: { status: "returned", value: undefined } },
    { id: 7, service: "docs", method: "delete", args: [deleted, "sha"], startedAt: "test", outcome: { status: "returned", value: undefined } },
    { id: 4, service: "scenario", method: "snapshot", args: [], startedAt: "test", outcome: { status: "returned", value: "FULL_WORLD" } },
    { id: 5, service: "debug", method: "record", args: [{ source: "accepted-transcript", output: "ignored" }], startedAt: "test" },
  ], world, final);
  let judged = false;
  const experiment = createReviewExperiment(oswinParlourCase, [], () => { throw new Error("No execution expected"); }, {
    decisions: async (evidence, questions) => {
      judged = true;
      assert.deepEqual(evidence, { transcript: oswinParlourCase.transcript, participants: oswinParlourCase.participants,
        characterId: oswinParlourCase.characterId, expectations: oswinParlourCase.expectations, error: undefined, documents: [
          { path, document: final.docs[path] },
          { path: untouchedWrite, document: final.docs[untouchedWrite] },
          { path: deleted, document: null },
        ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
      assert.doesNotMatch(JSON.stringify(evidence), /UNRELATED_READ|FULL_WORLD|INTERMEDIATE MEMORY|activity.md|contextDocuments|beforeIntent|physicalState/);
      return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "complete", probabilities: { complete: 1 } }]));
    },
  });
  const result = await experiment.score(recording, { signal: new AbortController().signal, recording: new Recording() });
  assert.ok(judged);
  assert.equal(result.criteria["physical-state"]?.score, 1);
});
