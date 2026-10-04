import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { classifyConversationTurn } from "../packages/providers/src/conversation-checks.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { logPath } from "../scripts/test-logging.js";

const records = () => readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line));

test("provider logs identify operations and distinguish JEV from LLM calls", async t => {
  const key = "provider-test-secret";
  const tool = { id: "tool-1", type: "function" as const, function: { name: "finish_review", arguments: '{"summary":"done"}' } };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.doesNotMatch(init.body as string, /character review|operation|callType/);
    return Response.json(url.endsWith("responses")
    ? { status: "completed", output: [{ type: "function_call", call_id: tool.id, ...tool.function }] }
    : { choices: [{ message: { role: "assistant", content: key, tool_calls: [tool] } }] });
  });
  const client = new OpenRouterClient(key);
  for (const api of [undefined, "responses"] as const) {
    await client.complete({ model: "test-model", messages: [{ role: "user", content: key }], ...(api ? { api } : {}) }, undefined, "character review (conversation)");
  }
  const jev = new JevClient(key, async () => Response.json({ answers: {
    next: { type: "choice", choice: "ignore", probabilities: { ignore: 1 }, confidence: 0.9 },
  } }));
  await jev.choose({}, "Decide", { ignore: "Ignore" }, new AbortController().signal, "NPC action selection");
  const failure = new Error(`network failure ${key}`);
  t.mock.method(globalThis, "fetch", async () => { throw failure; });
  await assert.rejects(client.complete({ model: "test-model", messages: [] }, undefined, "dialogue generation"), error => error === failure);
  const logs = records().filter(record => record.logger === "kingmaker.decisions");
  assert.equal(logs.length, 8);
  assert.deepEqual(logs.map(log => log.message), [
    "LLM: character review (conversation) requested", "LLM: character review (conversation) returned",
    "LLM: character review (conversation) requested", "LLM: character review (conversation) returned",
    "JEV: NPC action selection requested", "JEV: NPC action selection returned",
    "LLM: dialogue generation requested", "LLM: dialogue generation failed",
  ]);
  assert.equal(logs[4].properties.callType, "JEV");
  assert.equal(logs[0].properties.operation, "character review (conversation)");

  assert.doesNotMatch(JSON.stringify(logs), /provider-test-secret/);
  for (let i = 0; i < logs.length; i += 2) {
    assert.equal(logs[i].properties.requestId, logs[i + 1].properties.requestId);
    assert.ok(logs[i + 1].properties.durationMs >= 0);
  }
  assert.deepEqual(logs.slice(0, 6).filter((_, i) => i % 2 === 0).map(log => log.properties.provider),
    ["openrouter.chat", "openrouter.responses", "jev"]);
  assert.equal(logs[1].properties.response.tool_calls[0].function.name, "finish_review");
  assert.equal(logs[3].properties.response.tool_calls[0].function.name, "finish_review");
  assert.equal(logs[5].properties.response.next.choice, "ignore");
  assert.equal(logs[7].properties.error, "network failure [redacted]");
});

test("conversation classifier labels JEV requests and failures at the provider", async () => {
  const failure = new Error("classifier unavailable");
  const client = new JevClient("test-key", async () => { throw failure; });
  await assert.rejects(classifyConversationTurn(client, { playerTurn: "Let me pass." }, new AbortController().signal),
    error => error === failure);
  const logs = records().filter(record => record.logger === "kingmaker.decisions"
    && record.properties.operation === "conversation classification");
  assert.deepEqual(logs.map(log => log.message), [
    "JEV: conversation classification requested", "JEV: conversation classification failed",
  ]);
  assert.equal(logs[0].properties.requestId, logs[1].properties.requestId);
  assert.equal(logs[1].properties.callType, "JEV");
});
