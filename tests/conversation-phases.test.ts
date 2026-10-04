import assert from "node:assert/strict";
import test from "node:test";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runConversation } from "../packages/conversation/src/phases.js";

test("a response strategy owns generation and returns only its accepted reply", async () => {
  const drafts: string[] = [], prepared: string[] = [];
  const request = { model: "test", messages: [{ role: "user" as const, content: "A gift?" }] };
  const runtime = new ConversationRuntime({ services: { character: { respond: async input => {
    const reply = input.messages.length === 1 ? "Take the crown." : "Take this flower.";
    drafts.push(reply); return { role: "assistant", content: reply };
  } } }, strategies: { conversation: {
    respond: async (context, signal, services) => {
      await services.character.respond(context.request, signal);
      context.request.messages.push({ role: "system", content: "The crown cannot be given away." });
      return services.character.respond(context.request, signal);
    },
  } } });
  const reply = await runConversation(request, runtime, undefined, input => prepared.push(input.messages.at(-1)!.content!));
  assert.equal(reply.content, "Take this flower.");
  assert.deepEqual(drafts, ["Take the crown.", "Take this flower."]);
  assert.deepEqual(prepared, ["A gift?", "The crown cannot be given away."]);
  assert.equal(request.messages.length, 1);
});

test("a swapped strategy can return a response without calling the character model", async () => {
  const runtime = new ConversationRuntime({ strategies: { conversation: {
    respond: async () => ({ role: "assistant", content: "Fixed response" }),
  } } });
  assert.equal((await runConversation({ model: "test", messages: [] }, runtime)).content, "Fixed response");
});

test("strategy errors and cancellation cannot return a response", async () => {
  for (const mode of ["error", "cancel-before", "cancel-during"]) {
    const controller = new AbortController();
    if (mode === "cancel-before") controller.abort();
    const runtime = new ConversationRuntime({ strategies: { conversation: {
      respond: async () => {
        assert.notEqual(mode, "cancel-before");
        if (mode === "error") throw new Error("Response strategy failed");
        controller.abort();
        return { role: "assistant", content: "Too late" };
      },
    } } });
    await assert.rejects(runConversation({ model: "test", messages: [] }, runtime, controller.signal),
      mode === "error" ? /failed/ : /abort/i);
  }
});
