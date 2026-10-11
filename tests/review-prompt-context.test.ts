import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { reviewPromptContext } from "../packages/conversation/src/review-prompt-context.js";
import { loadPlayableWorld } from "./fixtures.js";

test("review variables read live quest and tree progress without including other character trees or history", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const runtime = new ConversationRuntime({ services });
  const context = { characterId: "aldren", participants: ["aldren", "player"], transcript: [] };
  const before = reviewPromptContext(context, runtime.services);
  assert.equal(JSON.parse(before.activeQuests).some((q: { quest: { id: string } }) => q.quest.id === "assembly_programme"), false);
  await services.quests.setActive("assembly_programme", true, 0);
  const after = reviewPromptContext(context, runtime.services);
  assert.equal(JSON.parse(after.activeQuests).some((q: { quest: { id: string } }) => q.quest.id === "assembly_programme"), true);
  const trees = JSON.parse(after.activeConversationTrees);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].path, "Conversations/aldren.md");
  assert.equal(trees[0].state.currentStageId, "greeting");
  assert.equal(trees[0].state.history, undefined);
  assert.match(after.youAreTheGameMaster, /story for the player/);
  const rowanTrees = JSON.parse(reviewPromptContext({ ...context, characterId: "rowan" }, runtime.services).activeConversationTrees);
  assert.deepEqual(rowanTrees.map((tree: { path: string }) => tree.path), ["Conversations/rowan.md"]);
});
