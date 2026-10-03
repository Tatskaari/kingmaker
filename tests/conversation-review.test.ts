import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, WorldStateSchema } from "../packages/contracts/src/index.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { classifyConversationReview, runConversationReview } from "../packages/conversation/src/review.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";

const evidence = () => ({ characterId: "alice", participants: ["alice", "player"],
  transcript: [create(TranscriptMessageSchema, { text: "I promise to help." })] });

test("review passes labels and unmodified evidence to a resolver using the shared services", async () => {
  const order: string[] = [];
  const services = createScenarioServices(worldState(create(WorldStateSchema), new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Index"], ["memory.md", "Memories"],
  ]), "Test"));
  const runtime = new ConversationRuntime({ services: { ...services, ai: { responses: async request => {
    order.push("gm");
    assert.match(request.messages[0]!.content!, /promise/);
    return { role: "assistant", content: "Agreed to help." };
  } } }, hooks: { review: { classify: async context => {
    order.push("classify");
    context.transcript[0]!.text = "Accidental mutation";
    return { promise: true };
  } } } });
  runtime.hooks.review.resolve = async (context, labels, signal, injected) => {
    order.push("resolve");
    assert.equal(context.transcript[0]!.text, "I promise to help.");
    assert.deepEqual(labels, { promise: true });
    assert.equal(injected.scenario.info().scenario, "Scenarios/Test/scenario.md");
    const reply = await injected.ai.responses({ model: "test", messages: [
      { role: "user", content: JSON.stringify({ context, labels }) },
    ] }, signal);
    const doc = await injected.docs.read("memory.md");
    await injected.docs.insert(doc.path, doc.sha, 1, reply.content!);
    return { summary: reply.content! };
  };
  const context = evidence();
  assert.equal((await runConversationReview(context, runtime)).summary, "Agreed to help.");
  assert.deepEqual(order, ["classify", "resolve", "gm"]);
  assert.equal(context.transcript[0]!.text, "I promise to help.");
  assert.match((await services.docs.read("memory.md")).text, /Agreed to help/);
});

test("stub classification still resolves; errors and cancellation stop the pipeline", async () => {
  for (const mode of ["success", "before", "classify", "between", "resolve", "after"]) {
    const controller = new AbortController();
    let resolves = 0;
    const runtime = new ConversationRuntime({ hooks: { review: {
      classify: async (context, signal) => {
        if (mode === "classify") throw new Error("classification failed");
        const labels = await classifyConversationReview(context, signal);
        if (mode === "between") controller.abort();
        return labels;
      },
      resolve: async (_context, labels) => {
        resolves++;
        assert.deepEqual(labels, {});
        if (mode === "resolve") throw new Error("resolution failed");
        if (mode === "after") controller.abort();
        return { summary: "Reviewed" };
      },
    } } });
    if (mode === "before") controller.abort();
    const result = runConversationReview(evidence(), runtime, controller.signal);
    if (mode === "success") assert.deepEqual(await result, { summary: "Reviewed" });
    else await assert.rejects(result, /abort|failed/i);
    assert.equal(resolves, ["success", "resolve", "after"].includes(mode) ? 1 : 0);
  }
});
