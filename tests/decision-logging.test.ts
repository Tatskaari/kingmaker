import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { runResourceReview } from "../apps/web/src/resource-review.js";
import { logPath } from "../scripts/test-logging.js";

const records = () => readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line));

test("all provider entry points log decisions, tool calls and redacted failures", async t => {
  const key = "provider-test-secret";
  const tool = { id: "tool-1", type: "function" as const, function: { name: "finish_review", arguments: '{"summary":"done"}' } };
  t.mock.method(globalThis, "fetch", async (url: string) => Response.json(url.endsWith("responses")
    ? { status: "completed", output: [{ type: "function_call", call_id: tool.id, ...tool.function }] }
    : { choices: [{ message: { role: "assistant", content: key, tool_calls: [tool] } }] }));
  const client = new OpenRouterClient(key);
  for (const api of [undefined, "responses"] as const) {
    await client.complete({ model: "test-model", messages: [{ role: "user", content: key }], ...(api ? { api } : {}) });
  }
  const jev = new JevClient(key, async () => Response.json({ answers: {
    next: { type: "choice", choice: "ignore", probabilities: { ignore: 1 }, confidence: 0.9 },
  } }));
  await jev.choose({}, "Decide", { ignore: "Ignore" }, new AbortController().signal);
  const failure = new Error(`network failure ${key}`);
  t.mock.method(globalThis, "fetch", async () => { throw failure; });
  await assert.rejects(client.complete({ model: "test-model", messages: [] }), error => error === failure);
  const logs = records().filter(record => record.logger === "kingmaker.decisions");
  assert.equal(logs.length, 8);
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

test("review logs rejected writes and the final successful finish", async () => {
  const transcripts = new ModelTranscripts("tool-test-secret");
  let round = 0;
  await runResourceReview({ model: "test", messages: [] }, [], {
    read: async () => ({}), write: async () => ({ commit_result: "error", reason: "stale tool-test-secret" }),
    finish: async () => {}, toolResult: (call, result) => transcripts.toolResult(call, result),
    complete: async () => ({ role: "assistant", content: null, tool_calls: [{ id: `review-${++round}`, type: "function",
      function: round === 1 ? { name: "update_character", arguments: '{}' } : { name: "finish_review", arguments: '{"summary":"done"}' } }] }),
  });
  const logs = records().filter(record => record.message === "LLM tool result");
  assert.equal(logs.length, 2);
  assert.equal(logs[0].properties.result.commit_result, "error");
  assert.equal(logs[0].properties.result.reason, "stale [redacted]");
  assert.equal(logs[1].properties.result.commit_result, "success");
});
