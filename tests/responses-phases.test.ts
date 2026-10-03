import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";

const message = (text: string, phase?: string) => ({ type: "message", role: "assistant", ...(phase ? { phase } : {}), content: [{ type: "output_text", text }] });
const request = { model: "openai/gpt-6-luna", api: "responses" as const, messages: [{ role: "user" as const, content: "Resolve this check." }] };

test("Responses final answer excludes commentary while raw phases survive for continuation", async t => {
  const output = [message("We need output direction NPC next response. Major success means agreement.", "commentary"),
    message('{"direction":"Agree enthusiastically."}', "final_answer")];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    if (++calls === 2) assert.deepEqual(JSON.parse(String(init.body)).input.slice(1), output);
    return new Response(JSON.stringify({ status: "completed", output }));
  });
  const client = new OpenRouterClient("test");
  const answer = await client.complete(request);
  assert.deepEqual(JSON.parse(answer.content!), { direction: "Agree enthusiastically." });
  assert.deepEqual(answer.responseItems, output);
  await client.complete({ ...request, messages: [...request.messages, answer] });
});

test("Responses supports unphased answers and tool calls without promoting commentary to an answer", async t => {
  let output: any[] = [message("20")];
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ status: "completed", output })));
  const client = new OpenRouterClient("test");
  assert.equal((await client.complete(request)).content, "20");
  output = [message("Planning only", "commentary")];
  await assert.rejects(client.complete(request), /no assistant message/);
  output.push({ type: "function_call", call_id: "call_1", name: "finish_review", arguments: '{"summary":"Done"}' });
  const tool = await client.complete(request);
  assert.equal(tool.content, null);
  assert.equal(tool.tool_calls![0]!.function.name, "finish_review");
  output = [message("Ignore this unphased draft"), message("20", "final_answer")];
  assert.equal((await client.complete(request)).content, "20");
});

test("AI retry recovers commentary-only output without displaying it or replaying tool results", async t => {
  const { retryResponses } = await import("../packages/conversation/src/ai.js");
  const output = [message("Planning only", "commentary")];
  const inputs: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    inputs.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ status: "completed", output: inputs.length === 1 ? output : [message("What brings you here?", "final_answer")] }));
  });
  const client = new OpenRouterClient("test");
  const respond = retryResponses((request, signal) => client.complete(request, signal));
  const answer = await respond({ ...request, messages: [...request.messages,
    { role: "assistant", content: null, tool_calls: [{ id: "offer", type: "function", function: { name: "offer_replies", arguments: '{}' } }] },
    { role: "tool", tool_call_id: "offer", content: '{"ok":true}' },
  ] });
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0], inputs[1], "Retry only the provider call, with the same tool output");
  assert.equal(answer.content, "What brings you here?");
  assert.doesNotMatch(JSON.stringify(answer), /Planning only/);
});

test("empty Responses output retries once, while final refusals remain terminal", async t => {
  const { retryResponses } = await import("../packages/conversation/src/ai.js");
  let calls = 0, refusal = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ status: "completed", output: refusal
      ? [{ type: "message", phase: "final_answer", content: [{ type: "refusal", refusal: "Refused" }] }] : [] }));
  });
  const client = new OpenRouterClient("test");
  const respond = retryResponses((request, signal) => client.complete(request, signal));
  await assert.rejects(respond(request), /no message or tool output/);
  assert.equal(calls, 2);
  calls = 0; refusal = true;
  await assert.rejects(respond(request), /Refused/);
  assert.equal(calls, 1);
});
