import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { classifyConversationExpression, portraitExpressions } from "../packages/providers/src/conversation-expression.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";

// @ts-expect-error The browser debug renderer is JavaScript.
import { recentTranscriptsView } from "../apps/web/src/debug-view.js";

const input = { characterId: "corvin", history: [{ speakerId: "player", text: "A joke." }, { speakerId: "corvin", text: "Ha!" }] };
test("Jev selects each supported expression using the conversation and portrait subject", async () => {
  for (const expression of Object.keys(portraitExpressions)) {
    const client = new JevClient("test-key", async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(request.state, input);
      assert.deepEqual(request.questions.next.criteria, portraitExpressions);
      return Response.json({ answers: { next: { type: "choice", choice: expression,
        probabilities: Object.fromEntries(Object.keys(portraitExpressions).map(key => [key, key === expression ? 1 : 0])) } } });
    });
    assert.equal((await classifyConversationExpression(client, input, new AbortController().signal)).expression, expression);
  }
  const invalid = new JevClient("test-key", async () => Response.json({ answers: {} }));
  await assert.rejects(classifyConversationExpression(invalid, input, new AbortController().signal), /invalid or unavailable/);
  await assert.rejects(classifyConversationExpression(invalid, input, AbortSignal.abort()), { name: "AbortError" });
});

test("recent displayed portraits reach Jev with guidance to reconsider repeated expressions", async () => {
  const recentPortraits = ["amused", "amused", "amused"] as const;
  const client = new JevClient("test-key", async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.state.recentPortraits, recentPortraits);
    assert.match(request.questions.next.instructions, /last three or more are identical/);
    assert.match(request.questions.next.instructions, /Do not invent an emotion solely for variety/);
    return Response.json({ answers: { next: { type: "choice", choice: "neutral", probabilities: Object.fromEntries(Object.keys(portraitExpressions).map(key => [key, key === "neutral" ? 1 : 0])) } } });
  });
  assert.equal((await classifyConversationExpression(client, { ...input, recentPortraits }, new AbortController().signal)).expression, "neutral");
});

function game() {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "test-key");
  runtime.createDevelopmentPlayer();
  return runtime;
}
test("expression classification logs the conversation without blocking or changing gameplay", async t => {
  const runtime = game();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: '{"utterance":"Ha!","replyOptions":[],"endConversation":false}' }));
  await runtime.talkToCharacter("corvin", "A joke.");
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  t.mock.method(JevClient.prototype, "choose", async (input: any) => {
    assert.equal(input.characterId, "corvin");
    assert.deepEqual(input.history.map((turn: any) => turn.text), ["A joke.", "Ha!"]);
    await waiting;
    return { choice: "amused", probabilities: { amused: 1 } };
  });
  const before = runtime.snapshot();
  const pending = runtime.logConversationExpression("corvin");
  assert.equal(runtime.recentTranscripts()[0]!.status, "pending");
  assert.deepEqual(runtime.snapshot(), before);
  finish(); await pending;
  assert.deepEqual(runtime.snapshot(), before);
  const entry = runtime.recentTranscripts()[0]!;
  assert.equal(entry.kind, "conversation_expression");
  assert.equal(entry.status, "success");
  assert.equal((entry.response as any).expression, "amused");
  assert.match(recentTranscriptsView([entry], {}, { session: `request:${entry.id}`, call: String(entry.id) }), /amused: 100%/);
});

test("classification failures are logged and missing conversations are skipped", async t => {
  const runtime = game();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: '{"utterance":"Hello.","replyOptions":[],"endConversation":false}' }));
  await runtime.talkToCharacter("corvin", "Hello");
  t.mock.method(JevClient.prototype, "choose", async () => { throw new Error("unavailable"); });
  const before = runtime.snapshot();
  await runtime.logConversationExpression("corvin");
  assert.deepEqual(runtime.snapshot(), before);
  assert.equal(runtime.recentTranscripts()[0]!.status, "error");
  assert.equal(runtime.recentTranscripts()[0]!.response, undefined);
  const count = runtime.recentTranscripts().length;
  await runtime.logConversationExpression("missing");
  assert.equal(runtime.recentTranscripts().length, count);
});

test("the classifier sees Stranger speech and the player, excluding setup and tools", async t => {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "test");
  assert.equal(await runtime.classifyStrangerExpression(), undefined);
  const saved = runtime.snapshot();
  saved.gameMasterHistory = [
    { role: "user", content: "[Crossroads character creation] Hidden setup" },
    { role: "assistant", content: null, tool_calls: [{ id: "tool", type: "function", function: { name: "offer_replies", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "tool", content: "Internal result" },
    { role: "assistant", content: "What do you want?" },
  ];
  runtime.restore(saved);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: "He laughs. A splendid joke!" }));
  await runtime.talkToGameMaster("I want to make them laugh.");
  t.mock.method(JevClient.prototype, "choose", async (input: any) => {
    assert.deepEqual(input, { characterId: "gm", history: [
      { speakerId: "gm", text: "What do you want?" },
      { speakerId: "player", text: "I want to make them laugh." },
      { speakerId: "gm", text: "He laughs. A splendid joke!" },
    ], recentPortraits: ["serious", "neutral", "amused", "amused", "amused"] });
    return { choice: "amused", probabilities: { amused: 1 } };
  });
  const before = runtime.snapshot();
  assert.equal(await runtime.classifyStrangerExpression(["angry", "serious", "neutral", "amused", "amused", "amused"]), "amused");
  await assert.rejects(runtime.classifyStrangerExpression(["invented"]), /Invalid portrait history/);
  assert.deepEqual(runtime.snapshot(), before);
  assert.equal(runtime.recentTranscripts()[0]!.kind, "conversation_expression");
  t.mock.method(JevClient.prototype, "choose", async () => { throw new Error("Offline"); });
  assert.equal(await runtime.classifyStrangerExpression(), undefined);
  assert.equal(runtime.recentTranscripts()[0]!.status, "error");
});
