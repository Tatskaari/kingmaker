import assert from "node:assert/strict";
import test from "node:test";
import { traceAiService, type AiSpan } from "../packages/conversation/src/ai-tracing.js";
import { aiService, decisionClient } from "../packages/conversation/src/adapters.js";

test("AI service correlates concurrent response and decision spans without changing provider payloads", async () => {
  const spans: AiSpan[] = [], requests: unknown[] = [];
  const context = { characterId: "rowan", participantIds: ["rowan", "player"], conversationId: "conversation", turnId: "turn", scenario: "court" };
  const failure = new Error("Failed");
  const ai = traceAiService(aiService({ complete: async request => { requests.push(request); return { role: "assistant", content: "Hello" }; } },
    { evaluate: async () => { throw failure; } }), () => context, async (span, _request, call) => { spans.push(span); return call(); }, "dialogue");
  const request = { model: "test", messages: [] };
  const results = await Promise.allSettled([ai.responses(request), ai.decisions({}, {}, new AbortController().signal, "skill_check")]);
  assert.equal(results[0]!.status, "fulfilled");
  assert.deepEqual(results[1], { status: "rejected", reason: failure });
  assert.equal(requests[0], request);
  assert.equal(spans.length, 2);
  assert.notEqual(spans[0]!.spanId, spans[1]!.spanId);
  assert.equal(spans[1]!.operation, "skill_check");
  assert.ok(spans.every(span => span.conversationId === "conversation" && span.turnId === "turn"));
  context.participantIds.push("holt");
  assert.deepEqual(spans[0]!.participantIds, ["rowan", "player"]);
});

test("legacy classifier adapter routes both decision methods through the AI service", async () => {
  let calls = 0;
  const client = decisionClient({ responses: async () => { throw new Error("unused"); }, decisions: async () => {
    calls++; return { next: { choice: "yes", probabilities: { yes: 1 } } };
  } });
  const signal = new AbortController().signal;
  assert.equal((await client.choose({}, "choose", { yes: "yes" }, signal)).choice, "yes");
  await client.evaluate({}, {}, signal);
  assert.equal(calls, 2);
});
