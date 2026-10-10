import assert from "node:assert/strict";
import test from "node:test";
import { createCorvinInquiryExperiment } from "../packages/evals/src/corvin-inquiry-case.js";
import { corvinInquiryCandidate } from "../packages/evals/src/corvin-inquiry-candidate.js";
import { createRecordedRuntime } from "../packages/evals/src/runtime.js";
import { Recording } from "../packages/service-tools/src/recording.js";
import { renderPrompt } from "../packages/prompts/src/index.js";

test("candidate changes only the activity prompt with the same starting world and setup", async () => {
  const ai = { responses: async () => { throw new Error("Unexpected model call"); }, decisions: async () => ({}) };
  const experiment = createCorvinInquiryExperiment(() => ai, ai, [corvinInquiryCandidate()]);
  const before = createRecordedRuntime(await experiment.getBaseline().configure(), new Recording());
  const after = createRecordedRuntime(await experiment.getVariants()[0]!.configure(), new Recording());
  assert.deepEqual(before.services.scenario.read(), after.services.scenario.read());
  const messages = [{ role: "system" as const, content: renderPrompt("review-activity") }, { role: "user" as const, content: "Same evidence" }];
  const context = { agent: "game_master" as const, characterId: "corvin", systemPrompt: renderPrompt("review-focused"), messages };
  const signal = new AbortController().signal;
  const original = await before.services.agents.prepare(context, signal);
  const candidate = await after.services.agents.prepare(context, signal);
  assert.notEqual(original[1]!.content, candidate[1]!.content);
  assert.match(candidate[1]!.content!, /Use the status field to save context/);
  assert.deepEqual(original.filter((_, index) => index !== 1), candidate.filter((_, index) => index !== 1));
  assert.equal(original[1]!.content, renderPrompt("review-activity"));
  const memory = { ...context, messages: [{ role: "system" as const, content: renderPrompt("review-commitment-memory") }] };
  assert.deepEqual(await before.services.agents.prepare(memory, signal), await after.services.agents.prepare(memory, signal));
});
