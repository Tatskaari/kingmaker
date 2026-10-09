import assert from "node:assert/strict";
import test from "node:test";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";

test("speech activity follows each NPC speaker without exposing dialogue or lingering during review", async () => {
  const traces = new ModelTranscripts("");
  const participants = ["rowan", "corvin"];
  const key = traces.start("npc_resolution", "rowan", "rowan", undefined, participants);
  for (const characterId of participants) {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const call = traces.record("dialogue", characterId, { private: "secret prompt" },
      async () => { await pending; return { content: "secret speech" }; }, key, characterId,
      { characterId, participantIds: participants, conversationId: key, turnId: characterId, spanId: characterId, operation: "dialogue" });
    assert.deepEqual(traces.speechBubbles(), [{ characterId, participantIds: participants }]);
    finish(); await call;
    assert.deepEqual(traces.speechBubbles(), []);
  }
  await traces.record("conversation_review", "rowan", {}, async () => {
    assert.deepEqual(traces.speechBubbles(), []);
  }, key);
  traces.finish(key);
  assert.deepEqual(traces.speechBubbles(), []);
});

test("stopped and failed runs clear their bubbles even with an outstanding model call", async () => {
  for (const status of ["stopped", "error"] as const) {
    const traces = new ModelTranscripts("");
    const key = traces.start("npc_resolution", "rowan");
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_, fail) => { reject = fail; });
    const call = traces.record("dialogue", "rowan", {}, () => pending, key);
    assert.equal(traces.speechBubbles().length, 1);
    if (status === "stopped") traces.stop(key); else traces.fail(key, new Error("Failed"));
    assert.deepEqual(traces.speechBubbles(), []);
    reject(new Error("Cancelled"));
    await assert.rejects(call, /Cancelled/);
    assert.deepEqual(traces.speechBubbles(), []);
  }
});
