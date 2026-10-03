import assert from "node:assert/strict";
import test from "node:test";
import { ProgressiveDisclosure } from "../packages/conversation/src/progressive-disclosure.js";
import { traceAiService } from "../packages/conversation/src/ai-tracing.js";
import type { LoreService } from "../packages/conversation/src/services.js";

const docs: LoreService = {
  initial: [{ path: "entry", markdown: "ENTRY" }],
  links: opened => opened.flatMap(doc => doc.path === "entry" ? [{ from: "entry", path: "detail", summary: "Relevant task detail" }]
    : [{ from: "detail", path: "nested" }, { from: "detail", path: "entry" }]),
  open: async link => ({ path: link.path, markdown: `${link.path.toUpperCase()}_BODY` }),
};
const context = [{ role: "system" as const, content: "ENTRY" }, { role: "user" as const, content: "Choose an action for the current goal." }];

test("generic disclosure recursively returns only new system messages using task context", async () => {
  const states: string[] = [];
  const pd = new ProgressiveDisclosure({ decisions: async (state, questions, _signal, purpose) => {
    assert.equal(purpose, "prog_disc");
    assert.match(String(state), /Choose an action/);
    assert.doesNotMatch(JSON.stringify(questions), /player message|next reply/);
    states.push(String(state));
    return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id, probabilities: { [id]: 1 } }]));
  } });
  const before = structuredClone(context);
  const messages = await pd.disclose(docs, context, new AbortController().signal);
  assert.deepEqual(messages, [
    { role: "system", content: "# Lore: detail\nDETAIL_BODY" },
    { role: "system", content: "# Lore: nested\nNESTED_BODY" },
  ]);
  assert.doesNotMatch(states[0]!, /DETAIL_BODY|NESTED_BODY/);
  assert.match(states[1]!, /DETAIL_BODY/);
  assert.deepEqual(context, before);
});

test("generic disclosure fails instead of returning partial context at its round limit", async () => {
  const pd = new ProgressiveDisclosure({ decisions: async (_state, questions) =>
    Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id, probabilities: { [id]: 1 } }])) }, { maxPasses: 1 });
  await assert.rejects(pd.disclose(docs, context, new AbortController().signal), /round limit/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pd.disclose(docs, context, controller.signal), /abort/i);
});


test("disclosure tracing retains document metadata and custom threshold with character attribution", async () => {
  const requests: unknown[] = [];
  const ai = traceAiService({ responses: async () => { throw new Error("unused"); },
    decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(id =>
      [id, { choice: "skip", probabilities: { [id]: 0.1, skip: 0.9 } }])) },
  characterId => ({ characterId: characterId!, participantIds: [], conversationId: "test", turnId: "turn" }),
  async (span, request, call) => { assert.equal(span.characterId, "aldren"); requests.push(request); return call(); }, "dialogue");
  await new ProgressiveDisclosure(ai, { threshold: 0.8 }).disclose(docs, context, new AbortController().signal, { characterId: "aldren" });
  assert.equal(requests.length, 1);
  assert.deepEqual((requests[0] as { disclosure: unknown }).disclosure, {
    threshold: 0.8, candidates: [{ id: "open_1", from: "entry", path: "detail", summary: "Relevant task detail" }],
  });
});
