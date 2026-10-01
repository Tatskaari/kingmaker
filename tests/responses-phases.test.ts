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
