import assert from "node:assert/strict";
import test from "node:test";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";

test("planning sessions retain all decisions and keep characters and resumed attempts separate", async () => {
  const log = new ModelTranscripts("secret");
  const first = log.start("npc_goal", "Corvin", "corvin", { goal: "Find the key" });
  const other = log.start("npc_goal", "Mara", "mara", { goal: "Find the key" });
  for (let i = 0; i < 55; i++) await log.record("jev", "corvin", { step: i }, async () => ({ choice: "walk" }), first);
  await log.record("jev", "mara", {}, async () => ({ choice: "wait" }), other);
  log.stop(first);
  log.finish(other);
  const resumed = log.start("npc_goal", "Corvin", "corvin", { goal: "Find the key" });
  await log.record("jev", "corvin", {}, async () => ({ choice: "complete" }), resumed);
  log.finish(resumed);
  assert.equal(log.runs()[first]?.calls.length, 55);
  assert.equal(log.runs()[first]?.status, "stopped");
  assert.equal(log.runs()[other]?.calls.length, 1);
  assert.equal(log.runs()[resumed]?.calls.length, 1);
  assert.equal(log.recent().length, 50);
  assert.equal(Object.keys(log.runs()).length, 3);
});
