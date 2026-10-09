import assert from "node:assert/strict";
import test from "node:test";
import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { createReviewExperiment, documentChanges } from "../packages/evals/src/review-experiment.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { defaultWorldStrategies } from "../apps/web/src/world-strategies.js";
import { commitReview, loadPlayableWorld } from "./fixtures.js";
import transcript from "../evals/reviews/oswin-parlour.json" with { type: "json" };

test("review experiments replay real tools, record only docs, and grade final files without variant identity", async () => {
  const source = loadPlayableWorld();
  let attentionCalls = 0;
  const experiment = createReviewExperiment({ name: "oswin", characterId: "oswin", participants: ["oswin", "player"],
    transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)), expectations: "Go to the parlour.", loadWorld: () => loadPlayableWorld(),
  }, [{ name: "candidate" }], () => ({
    responses: async request => commitReview({ summary: "Reviewed", newNotes: ["The player ordered me to the parlour."], activeGoal: "Go to the parlour." }, request),
    decisions: async (_state, questions) => {
      attentionCalls++;
      return Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "flagged", probabilities: { flagged: 1 } }]));
    },
  }), { decisions: async (state, questions) => {
    const evidence = state as { documents: unknown[] };
    assert.ok(evidence.documents.length >= 1);
    assert.doesNotMatch(JSON.stringify(evidence), /"variant":|"candidate"/);
    return Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "complete", probabilities: { complete: 1 } }]));
  } });
  assert.equal((await experiment.getBaseline().configure()).strategies!.setup, defaultWorldStrategies.setup);
  const trials = await runExperiment(experiment, { repeats: 1 });
  assert.equal(attentionCalls, 2, "Each trial reviews its accepted turn without a duplicate final review");
  for (const trial of trials) {
    assert.equal(trial.recording.error, undefined, JSON.stringify(trial.recording.error));
    assert.equal(trial.scoringError, undefined, JSON.stringify(trial.scoringError));
    assert.equal(trial.result!.criteria["physical-state"]!.score, 1);
    assert.ok(trial.recording.getServiceRecord("docs").some(call => call.method === "commit"));
    assert.deepEqual([...new Set(trial.recording.calls.map(call => call.service))], ["docs"]);
    assert.equal(trial.gradingCalls.filter(call => call.service === "ai").length, 1);
    assert.ok(documentChanges(trial.recording).some(change => change.after?.body.includes("ordered me")));
  }
  assert.deepEqual(trials[0]!.recording.initialState, trials[1]!.recording.initialState);
  assert.notEqual(documentChanges(trials[0]!.recording).find(change => !change.before)!.path,
    documentChanges(trials[1]!.recording).find(change => !change.before)!.path, "Each run creates its own activity document");
  assert.ok(!Object.values(source.docs).some(doc => doc.body.includes("The player ordered me to the parlour.")));
});


test("review comparison runs conversation turns, drains their work, then reviews the accepted transcript", async () => {
  const events: string[] = [];
  let pending = false;
  const testCase = { name: "oswin", characterId: "oswin", participants: ["oswin", "player"],
    transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)), expectations: "Go to the parlour.", loadWorld: () => loadPlayableWorld() };
  const experiment = createReviewExperiment(testCase, [{ name: "candidate", conversation: () => ({
    strategy: { respond: async (context, signal, services) => {
      events.push("respond");
      const draft = await services.character.respond(context.request, signal);
      assert.equal(draft.content, testCase.transcript.at(-1)!.text);
      assert.ok(context.request.messages.some(message => message.role === "system" && message.content?.includes("20")));
      pending = true;
      return { ...draft, content: "Accepted reply" };
    } },
    drain: async () => { if (pending) { events.push("drained"); pending = false; } },
  }), strategies: { review: {
    classify: async context => {
      assert.equal(pending, false);
      assert.equal(context.transcript.at(-1)!.text, "Accepted reply");
      assert.deepEqual(context.transcript.slice(0, -1), testCase.transcript.slice(0, -1));
      events.push("classify"); return {};
    },
    resolve: async () => { events.push("review"); return { summary: "Reviewed" }; },
  } } }], () => ({ responses: async request => { throw new Error("Unexpected model call"); }, decisions: async () => ({}) }), { decisions: async () => ({}) });
  const { createRecordedRuntime } = await import("../packages/evals/src/runtime.js");
  const { Recording } = await import("../packages/service-tools/src/recording.js");
  const runtime = createRecordedRuntime(await experiment.getVariants()[0]!.configure(), new Recording());
  await experiment.run(runtime, new AbortController().signal);
  assert.deepEqual(events, ["respond", "drained", "classify", "review"]);
});
