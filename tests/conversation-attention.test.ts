import { cliStrategy } from "../packages/conversation/src/cli-strategy.js";
import { DisclosureSession } from "../packages/conversation/src/disclosure.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyzeAttention, attentionQuestions } from "../packages/conversation/src/attention.js";
import { runConversation } from "../packages/conversation/src/phases.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";

test("attention uses the latest reply and exact disclosed evidence with independent flags", async () => {
  const messages = [{ role: "system" as const, content: "The door is locked." }];
  const characterReply = { role: "assistant" as const, content: "I'll open it now and bring the seal tomorrow." };
  const decisions = { immediate_commitment: { choice: "flagged", probabilities: { flagged: 0.9, not_flagged: 0.1 } } };
  assert.equal(await analyzeAttention({ responses: async () => { throw Error("Unexpected narration"); },
    decisions: async (state, questions, _signal, purpose) => {
      assert.deepEqual(state, { messages, characterReply });
      assert.equal(purpose, "conversation_attention");
      assert.deepEqual(Object.keys(questions), [...Object.keys(attentionQuestions)]);
      assert.ok(questions.deferred_commitment && questions.conversational_exchange && questions.improvised_detail);
      assert.ok(questions.immediate_feasibility?.criteria.unknown);
      return decisions;
    },
  }, messages, characterReply, new AbortController().signal), decisions);
});

test("the shared response strategy analyzes a detached draft before returning it", async () => {
  const order: string[] = [];
  const ai = { responses: async () => { throw new Error("Unexpected GM call"); },
    decisions: async (state: unknown, questions: import("../packages/providers/src/jev.js").JevQuestions, _signal?: AbortSignal, purpose?: string) => {
      if (purpose === "conversation_attention") {
        order.push("analyze");
        const evidence = state as { messages: { content: string }[]; characterReply: { content: string } };
        assert.equal(evidence.messages.at(-1)?.content, "The seal?");
        evidence.messages.length = 0; evidence.characterReply.content = "Changed";
      }
      return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "not_needed", probabilities: { not_needed: 1 } }]));
    } };
  const disclosure = new DisclosureSession({ initial: [], links: () => [], open: async () => { throw new Error("Unexpected disclosure"); } }, ai);
  const runtime = new ConversationRuntime({ services: { character: { respond: async () => {
    order.push("respond"); return { role: "assistant", content: "Here is the seal." };
  } } }, strategies: { conversation: cliStrategy(disclosure, ai, undefined, "The seal?",
    async () => { throw new Error("Unexpected roll"); }, () => {}, () => {}) } });
  const reply = await runConversation({ model: "test", messages: [{ role: "user", content: "The seal?" }] }, runtime);
  assert.deepEqual(order, ["respond", "analyze"]);
  assert.equal(reply.content, "Here is the seal.");
});
