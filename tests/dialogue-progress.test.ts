import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

test("Responses reports visible text before completion and hides commentary and tool arguments", async t => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { body = controller; } }),
    { headers: { "Content-Type": "text/event-stream" } }));
  const send = (event: unknown) => body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  const updates: string[] = [];
  let arrived!: () => void;
  const partial = new Promise<void>(resolve => { arrived = resolve; });
  let complete = false;
  const pending = new OpenRouterClient("test").complete({ model: "test", api: "responses", messages: [] }, undefined, undefined, text => {
    updates.push(text); if (text === "Hello") arrived();
  }).then(reply => { complete = true; return reply; });
  send({ type: "response.output_item.added", output_index: 0, item: { type: "message", phase: "commentary" } });
  send({ type: "response.output_text.delta", output_index: 0, delta: "secret reasoning" });
  send({ type: "response.function_call_arguments.delta", output_index: 1, delta: "secret arguments" });
  send({ type: "response.output_item.added", output_index: 2, item: { type: "message", phase: "final_answer" } });
  send({ type: "response.output_text.delta", output_index: 2, delta: "Hello" });
  await partial;
  assert.equal(complete, false, "Text must arrive while generation is still running");
  send({ type: "response.output_text.delta", output_index: 2, delta: " world" });
  send({ type: "response.completed", response: { status: "completed", output: [
    { type: "message", phase: "final_answer", content: [{ type: "output_text", text: "Hello world" }] },
  ] } });
  assert.equal((await pending).content, "Hello world");
  assert.ok(updates.includes("Hello"));
  assert.equal(updates.at(-1), "Hello world");
  assert.ok(updates.every(text => !text.includes("secret")));
});

test("chat clears a provisional reply if the stream fails", async t => {
  const events = [{ choices: [{ index: 0, delta: { content: "unfinished" } }] }, { error: { message: "disconnected" } }];
  t.mock.method(globalThis, "fetch", async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }));
  const updates: string[] = [];
  await assert.rejects(new OpenRouterClient("test").complete({ model: "test", messages: [] }, undefined, undefined, text => updates.push(text)));
  assert.deepEqual(updates, ["", "unfinished", ""]);
});

test("runtime streams the Stranger but publishes court replies only after committing", async t => {
  for (const court of [false, true]) {
    const world = loadPlayableWorld();
    if (!court) { delete world.docs[world.player!]; delete world.player; }
    const runtime = new WorldGameRuntime(world, "test", undefined, undefined, undefined, {
      services: { disclosure: { disclose: async () => [] } },
      strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal), } },
    });
    if (!court) runtime.startIntroduction();
    const before = JSON.stringify(runtime.snapshot());
    const updates: string[] = [];
    let finish!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    t.mock.method(OpenRouterClient.prototype, "complete", async (_request: unknown, _signal: unknown, _operation: unknown, onText?: (text: string) => void) => {
      assert.equal(typeof onText, court ? "undefined" : "function");
      onText?.("Hello"); started();
      await gate;
      return { role: "assistant", content: "Hello world" };
    });
    const onText = (text: string) => updates.push(text);
    const pending = court ? runtime.checkedTalkToCharacter("rowan", "Hi", undefined, {}, undefined, onText)
      : runtime.talkToGameMaster("Hi", onText);
    await ready;
    assert.deepEqual(updates, court ? [] : ["Hello"]);
    assert.equal(JSON.stringify(runtime.snapshot()), before);
    finish();
    assert.equal(await pending, "Hello world");
    if (court) assert.deepEqual(updates, ["Hello world"]);
    assert.ok(JSON.stringify(runtime.view()).includes("Hello world"));
    t.mock.restoreAll();
  }
});
