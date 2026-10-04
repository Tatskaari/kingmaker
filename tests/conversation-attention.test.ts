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

test("analysis runs once after disclosure settles and sees detached reply evidence", async () => {
  const order: string[] = [];
  const runtime = new ConversationRuntime({ services: { character: { respond: async () => {
    order.push("respond"); return { role: "assistant", content: "Here is the seal." };
  } } }, strategies: { conversation: {
    classify: async () => ({}), resolve: async context => {
      if (context.pass === 1) { context.request.messages.push({ role: "system", content: "Disclosed seal" }); return { reclassify: true }; }
      return { reclassify: false };
    }, analyze: async (context, reply) => {
      order.push("analyze"); assert.equal(context.request.messages.at(-1)?.content, "Disclosed seal");
      context.request.messages.length = 0;
      (reply as { content: string }).content = "Changed";
    },
  } } });
  const reply = await runConversation({ model: "test", messages: [{ role: "user", content: "The seal?" }] }, runtime);
  assert.deepEqual(order, ["respond", "analyze"]);
  assert.equal(reply.content, "Here is the seal.");
});
