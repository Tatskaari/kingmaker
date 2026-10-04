import assert from "node:assert/strict";
import test from "node:test";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runResolution, type ResolutionContext } from "../packages/conversation/src/resolution.js";

const evidence: ResolutionContext = { kind: "world_event", characterId: "alice", eventId: "event", perception: "Indistinct voices." };
test("resolution isolates classification evidence, forwards labels/services and propagates cancellation", async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    let resolved = false;
    const runtime = new ConversationRuntime({ strategies: { resolution: {
      classify: async (context, signal, services) => {
        assert.equal(signal, controller.signal); assert.equal(services, runtime.services);
        (context as { perception: string }).perception = "Invented secret";
        if (abort) controller.abort();
        return { react: true };
      },
      resolve: async (context, labels) => {
        resolved = true;
        assert.deepEqual(context, evidence); assert.deepEqual(labels, { react: true });
        return { summary: "Heard voices." };
      },
    } } });
    const result = runResolution(evidence, runtime, controller.signal);
    if (abort) await assert.rejects(result, /abort/i);
    else assert.equal((await result).summary, "Heard voices.");
    assert.equal(resolved, !abort);
  }
});
