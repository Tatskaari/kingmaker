import assert from "node:assert/strict";
import test from "node:test";
import { ProgressiveDisclosure } from "../packages/conversation/src/progressive-disclosure.js";
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
