import assert from "node:assert/strict";
import test from "node:test";
import { recoverRateLimit, retryDelay } from "../packages/providers/src/rate-limit.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";

test("Retry-After supports seconds, dates, and fallback backoff", () => {
  assert.equal(retryDelay("12", 0), 12_000);
  assert.equal(retryDelay("0", 0), 0);
  assert.equal(retryDelay("Thu, 01 Jan 1970 00:01:00 GMT", 0, 0), 60_000);
  assert.equal(retryDelay("Thu, 01 Jan 1970 00:01:00 GMT", 0, 90_000), 0);
  for (const header of [null, "", "nonsense"]) {
    assert.ok(retryDelay(header, 0) >= 60_000);
    assert.ok(retryDelay(header, 1) >= 120_000);
  }
});

test("429 retries are bounded and other errors are not replayed", async () => {
  let calls = 0;
  const response = await recoverRateLimit(async () => {
    calls++; return new Response("limited", { status: 429, headers: { "Retry-After": "0" } });
  });
  assert.equal(calls, 6);
  assert.equal(await response.text(), "limited");
  calls = 0;
  await recoverRateLimit(async () => { calls++; return new Response("", { status: 402 }); });
  assert.equal(calls, 1);
});

test("cancellation interrupts a cooldown without sending another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = recoverRateLimit(async () => {
    calls++;
    setTimeout(() => controller.abort(), 5);
    return new Response("", { status: 429, headers: { "Retry-After": "120" } });
  }, controller.signal);
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("chat and Responses requests recover in place after 429", async t => {
  for (const api of [undefined, "responses"] as const) {
    let calls = 0;
    const bodies: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      calls++; bodies.push(String(init.body));
      if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      return Response.json(api ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Recovered" }] }] }
        : { choices: [{ message: { role: "assistant", content: "Recovered" } }] });
    });
    const reply = await new OpenRouterClient("test").complete({ model: "test", ...(api ? { api } : {}), messages: [] });
    assert.equal(reply.content, "Recovered");
    assert.equal(calls, 2);
    assert.equal(bodies[0], bodies[1]);
    t.mock.restoreAll();
  }
});

test("Jev resumes the same decision after 429", async () => {
  let calls = 0;
  const http: typeof fetch = async () => {
    if (++calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
    return Response.json({ answers: { next: { type: "choice", choice: "wait", probabilities: { wait: 1 } } } });
  };
  const result = await new JevClient("test", http).choose({}, "Decide", { wait: "Wait" }, new AbortController().signal);
  assert.equal(result.choice, "wait");
  assert.equal(calls, 2);
});
