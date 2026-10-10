import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { QuestSchema } from "../packages/contracts/src/v2.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

test("only a successful player exchange with the target completes an active quest and survives resume", async () => {
  let fail = false;
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    services: { disclosure: { disclose: async () => [] }, ai: { decisions: async (_state, questions, _signal, purpose) => {
      assert.equal(purpose, "conversation_tree");
      return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "miss", probabilities: { miss: 1 } }]));
    } } },
    strategies: { conversation: { respond: async () => {
      if (fail) throw new Error("Provider failed");
      return { role: "assistant", content: "Welcome to court." };
    } } },
  });
  assert.deepEqual((runtime.view().activeQuests as { title: string }[]).map(quest => quest.title), ["Talk to King Aldren"]);
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
  assert.deepEqual(runtime.view().activeQuests, []);
  const introduction = runtime.services.quests.read("talk_to_aldren");
  assert.equal(introduction.currentStageId, "completed");
  assert.equal(introduction.active, false);
  const completed = runtime.services.quests.read("greeting");
  assert.equal(completed.currentStageId, "done");
  assert.equal(completed.active, false);
  assert.equal(completed.history.length, 1);
  assert.equal(completed.history[0]!.evidence, "Player talked to aldren.");
  runtime.restore(runtime.snapshot());
  await runtime.checkedTalkToCharacter("aldren", "Hello again.");
  assert.deepEqual(runtime.services.quests.read("greeting"), completed);
  assert.deepEqual(runtime.services.quests.read("talk_to_aldren"), introduction);
});
