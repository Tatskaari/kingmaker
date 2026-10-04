import assert from "node:assert/strict";
import test from "node:test";
import { traceCliGmCalls, gmCallLabel, type CliGmCall } from "../apps/conversation-cli/gm-calls.js";
import type { ChatCompletionRequest, OpenRouterMessage } from "../packages/providers/src/openrouter.js";

test("GM approval and review traces retain pending state, tool transcripts and stable IDs", async () => {
  const events: CliGmCall[] = [];
  let finish: (reply: OpenRouterMessage) => void = () => {};
  const pending = new Promise<OpenRouterMessage>(resolve => { finish = resolve; });
  const signal = new AbortController().signal;
  const info = { purpose: "gm_consultation" as const, characterId: "corvin" };
  const ai = traceCliGmCalls({ decisions: async () => ({}), responses: async (_request, cancellation, metadata) => {
    assert.equal(cancellation, signal); assert.deepEqual(metadata, info); return pending;
  } }, call => events.push(call), () => "gm-0");
  const request: ChatCompletionRequest = { model: "test", messages: [
    { role: "user", content: "Review the accepted gift." },
    { role: "tool", tool_call_id: "edit-1", content: '{"ok":true}' },
  ], tools: [{ type: "function", function: { name: "commit_review", description: "Finish review", parameters: {} } }] };
  const operation = ai.responses(request, signal, info);
  assert.equal(gmCallLabel(events[0]!), "GM review · pending");
  const reply: OpenRouterMessage = { role: "assistant", content: null,
    tool_calls: [{ id: "commit-1", type: "function", function: { name: "commit_review", arguments: '{}' } }] };
  finish(reply); await operation;
  assert.equal(events[1]?.id, events[0]?.id);
  assert.deepEqual(events[1]?.request.messages, request.messages);
  assert.deepEqual(events[1]?.response, reply);
  assert.equal(gmCallLabel(events[1]!), "GM review · completed");
});

test("GM labels distinguish approvals from rolls and failures remain inspectable", async () => {
  for (const [name, purpose] of [["conversation_approval", "approval"], ["conversation_roll_ruling", "roll ruling"]]) {
    const events: CliGmCall[] = [];
    const ai = traceCliGmCalls({ decisions: async () => ({}), responses: async () => { throw new Error("Provider failed"); } }, call => events.push(call));
    await assert.rejects(ai.responses({ model: "test", messages: [], response_format: { type: "json_schema", json_schema: { name } } }), /Provider failed/);
    assert.equal(events[0]?.purpose, purpose);
    assert.equal(events[1]?.status, "failed");
    assert.match(events[1]?.error ?? "", /Provider failed/);
  }
});
