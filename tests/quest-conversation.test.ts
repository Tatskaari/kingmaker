import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { QuestSchema } from "../packages/contracts/src/v2.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

test("only a successful player exchange with the target completes an active quest and survives resume", async () => {
  let fail = false;
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    services: { disclosure: { disclose: async () => [] } },
    strategies: { conversation: { respond: async () => {
      if (fail) throw new Error("Provider failed");
      return { role: "assistant", content: "Welcome to court." };
    } } },
  });
  await runtime.services.quests.register(create(QuestSchema, {
    id: "greeting", title: "Talk to King Aldren", initialStageId: "arrived",
    stages: [{ id: "arrived" }, { id: "done", completed: true }],
    transitions: [{ id: "greet", fromStageId: "arrived", toStageId: "done", playerTalkedTo: "aldren" }],
  }));
  await runtime.services.quests.setActive("greeting", true, 0);
  await runtime.checkedTalkToCharacter("rowan", "Hello.");
  assert.equal(runtime.services.quests.read("greeting").currentStageId, "arrived");
  fail = true;
  await assert.rejects(runtime.checkedTalkToCharacter("aldren", "Hello."), /Provider failed/);
  assert.equal(runtime.services.quests.read("greeting").active, true);
  fail = false;
  await runtime.checkedTalkToCharacter("aldren", "Hello.");
  const completed = runtime.services.quests.read("greeting");
  assert.equal(completed.currentStageId, "done");
  assert.equal(completed.active, false);
  assert.equal(completed.history.length, 1);
  assert.equal(completed.history[0]!.evidence, "Player talked to aldren.");
  runtime.restore(runtime.snapshot());
  await runtime.checkedTalkToCharacter("aldren", "Hello again.");
  assert.deepEqual(runtime.services.quests.read("greeting"), completed);
});
