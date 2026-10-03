import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterClient, OutputTokenLimitError, ProviderResponseError } from "../packages/providers/src/openrouter.js";

const request = { model: "test", messages: [] };
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(": heartbeat\n\n" + events.map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

test("chat streaming joins text and interleaved tool arguments after a rate-limit retry", async t => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.equal(JSON.parse(String(init.body)).stream, true);
    if (++attempts === 1) return new Response("limited", { status: 429, headers: { "Retry-After": "0" } });
    return stream([
      chunk({ role: "assistant", content: "Hé " }), chunk({ content: "👑" }),
      chunk({ tool_calls: [
        { index: 1, id: "two", type: "function", function: { name: "second", arguments: "{" } },
        { index: 0, id: "one", type: "function", function: { name: "first", arguments: '{"ok":' } },
      ] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "true}" } }, { index: 1, function: { arguments: "}" } }] }, "tool_calls"),
      { choices: [], usage: { completion_tokens: 10 } }, "[DONE]",
    ]);
  });
  const answer = await new OpenRouterClient("test").complete(request);
  assert.equal(attempts, 2);
  assert.equal(answer.content, "Hé 👑");
  assert.deepEqual(answer.tool_calls, [
    { id: "one", type: "function", function: { name: "first", arguments: '{"ok":true}' } },
    { id: "two", type: "function", function: { name: "second", arguments: "{}" } },
  ]);
});

test("Responses streaming preserves final phases, tool calls and reasoning for continuation", async t => {
  const output = [
    { type: "reasoning", encrypted_content: "opaque" },
    { type: "message", phase: "commentary", content: [{ type: "output_text", text: "Thinking" }] },
    { type: "message", phase: "final_answer", content: [{ type: "output_text", text: '{"answer":20}' }] },
    { type: "function_call", call_id: "one", name: "finish", arguments: "{}" },
  ];
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(url, /\/responses$/);
    const body = JSON.parse(String(init.body));
    assert.equal(body.stream, true);
    if (++attempts === 2) assert.deepEqual(body.input, output);
    return stream([{ type: "response.output_text.delta", delta: "Thinking" },
      { type: "response.completed", response: { status: "completed", output } }]);
  });
  const client = new OpenRouterClient("test");
  const answer = await client.complete({ ...request, api: "responses" });
  assert.equal(answer.content, '{"answer":20}');
  assert.deepEqual(answer.responseItems, output);
  assert.equal(answer.tool_calls![0]!.id, "one");
  await client.complete({ ...request, api: "responses", messages: [answer] });
});

test("stream failures reject partial content and preserve retry and token-limit semantics", async t => {
  const cases: Array<[unknown[], "responses" | undefined, typeof ProviderResponseError | typeof OutputTokenLimitError, boolean?]> = [
    [[chunk({ content: "partial" })], undefined, ProviderResponseError, true],
    [[chunk({ content: "partial" }), "[DONE]"], undefined, ProviderResponseError, true],
    [[chunk({ content: "partial" }, "stop")], undefined, ProviderResponseError, true],
    [[chunk({}, "stop"), "[DONE]"], undefined, ProviderResponseError, true],
    [["{broken"], undefined, ProviderResponseError, true],
    [[{ error: { code: "server_error", message: "disconnected" } }], undefined, ProviderResponseError, true],
    [[{ error: { code: 402, message: "credits" } }], undefined, ProviderResponseError, false],
    [[chunk({ content: "partial" }, "length")], undefined, OutputTokenLimitError],
    [[chunk({}, "content_filter")], undefined, ProviderResponseError, false],
    [[{ type: "response.failed", response: { error: { message: "disconnected" } } }], "responses", ProviderResponseError, true],
    [[{ type: "response.output_text.delta", delta: "partial" }, "[DONE]"], "responses", ProviderResponseError, true],
    [[{ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }], "responses", OutputTokenLimitError],
  ];
  for (const [events, api, errorType, retryable] of cases) {
    t.mock.method(globalThis, "fetch", async () => stream(events));
    await assert.rejects(new OpenRouterClient("test").complete({ ...request, ...(api ? { api } : {}) }), error => {
      assert.ok(error instanceof errorType);
      if (retryable !== undefined) assert.equal((error as ProviderResponseError).retryable, retryable);
      return true;
    });
    t.mock.restoreAll();
  }
});

test("provider cancellation and timeout interrupt stalled streams after headers", async t => {
  for (const abort of [true, false]) {
    let cancelled = false;
    const controller = new AbortController();
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
      start(body) { body.enqueue(new TextEncoder().encode(': waiting\n\n')); },
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "text/event-stream" } }));
    const pending = new OpenRouterClient("test", abort ? 60_000 : 10).complete(request, controller.signal);
    const timer = setTimeout(() => { if (abort) controller.abort(); }, 20);
    try { await assert.rejects(pending, { name: abort ? "AbortError" : "TimeoutError" }); }
    finally { clearTimeout(timer); }
    assert.ok(cancelled);
    t.mock.restoreAll();
  }
});
