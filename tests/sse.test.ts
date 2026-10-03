import assert from "node:assert/strict";
import test from "node:test";
import { serverSentData } from "../packages/providers/src/sse.js";

test("SSE decodes split UTF-8, all line endings, comments and multiline data", async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: delta\r\ndata: Hé 👑\r\ndata: second line\r\n\r\ndata: third\n\ndata: fourth\r\rdata: unfinished');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const events: string[] = [];
  for await (const data of serverSentData(response, new AbortController().signal)) events.push(data);
  assert.deepEqual(events, ["Hé 👑\nsecond line", "third", "fourth"]);
});

test("SSE cancels and unlocks its reader when the consumer stops", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("data: first\n\ndata: second\n\n")); },
    cancel() { cancelled = true; },
  }));
  for await (const data of serverSentData(response, new AbortController().signal)) {
    assert.equal(data, "first"); break;
  }
  assert.ok(cancelled);
  assert.equal(response.body!.locked, false);
});

test("SSE cancellation interrupts a stalled body read", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const controller = new AbortController();
  const next = serverSentData(response, controller.signal).next();
  controller.abort();
  await assert.rejects(next, { name: "AbortError" });
  assert.ok(cancelled);
  assert.equal(response.body!.locked, false);
});
