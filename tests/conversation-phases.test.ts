import assert from "node:assert/strict";
import test from "node:test";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runConversation } from "../packages/conversation/src/phases.js";

test("classifiers return shared labels, resolvers update context, then one reply uses the result", async () => {
  const order: string[] = [], request = { model: "test", messages: [{ role: "user" as const, content: "Hello" }] };
  const runtime = new ConversationRuntime({ services: { character: { respond: async prepared => {
    order.push("respond");
    assert.deepEqual(prepared.messages.map(message => message.content), ["Hello", "Opened lore", "Resolved check"]);
    return { role: "assistant", content: "Reply" };
  } } }, hooks: { conversation: {
    classify: async context => {
      order.push(`classify ${context.pass}`);
      const labels = { open: context.pass === 1, check: context.request.messages.length > 1 };
      context.request.messages.push({ role: "system", content: "Accidental classifier mutation" });
      return labels;
    },
    resolve: async (context, labels) => {
      order.push(`resolve ${context.pass}`);
      assert.ok(!context.request.messages.some(message => message.content?.includes("Accidental")));
      if (labels.open) {
        context.request.messages.push({ role: "system", content: "Opened lore" });
        context.completed.add("opened"); return { reclassify: true };
      }
      assert.ok(context.completed.has("opened"));
      assert.equal(labels.check, true);
      context.request.messages.push({ role: "system", content: "Resolved check" });
      return { reclassify: false };
    },
  } } });
  await runConversation(request, runtime);
  assert.deepEqual(order, ["classify 1", "resolve 1", "classify 2", "resolve 2", "respond"]);
  assert.equal(request.messages.length, 1);
});

test("errors, cancellation and pass limits cannot fall through to dialogue", async () => {
  for (const mode of ["classify", "resolve", "cancel", "limit"]) {
    const controller = new AbortController();
    const runtime = new ConversationRuntime({ maxPasses: 2, services: { character: {
      respond: async () => { assert.fail("No reply allowed"); },
    } }, hooks: { conversation: {
      classify: async () => {
        if (mode === "classify") throw new Error("classification failed");
        if (mode === "cancel") controller.abort();
        return {};
      },
      resolve: async () => {
        if (mode === "resolve") throw new Error("resolution failed");
        return { reclassify: true };
      },
    } } });
    await assert.rejects(runConversation({ model: "test", messages: [] }, runtime, controller.signal),
      mode === "cancel" ? /abort/i : mode === "limit" ? /round limit/ : /failed/);
  }
});
