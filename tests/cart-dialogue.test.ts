import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";
import { pillowLead } from "../packages/conversation/src/tree-scripts/pillow-lead.js";

test("Holt must disclose the lead before the quest advances, and resume does not repeat it", async () => {
  let disclose = false;
  const game = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    services: { disclosure: { disclose: async () => [] }, ai: { decisions: async (input, questions) => {
      const evidence = input as { conversation: { speaker: string; text: string }[] };
      const last = evidence.conversation.at(-1)!;
      return Object.fromEntries(Object.keys(questions).map(id => [id, {
        choice: (id === "pillows-raised" && last.speaker === "player")
          || (id === "lead-from-interruption" && last.speaker === "holt" && last.text.includes("blocked")) ? "hit" : "miss",
        probabilities: {},
      }]));
    } } }, strategies: { conversation: { respond: async () => ({ role: "assistant", content: disclose
      ? "Your pillows are probably blocked by Rowan's cart too." : "Pillows? I have a whole assembly to organise!" }) } },
  });
  try {
    await game.checkedTalkToCharacter("holt", "Where are the pillows?");
    assert.equal(game.services.quests.read("assembly_programme").currentStageId, "investigate_missing_pillows");
    disclose = true;
    await game.checkedTalkToCharacter("holt", "Let me help. What is delaying things?");
    const state = game.services.quests.read("assembly_programme");
    assert.equal(state.currentStageId, "cart_blocked");
    assert.equal(state.active, true);
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0]!.transitionId, "learn_cart_blocked");
    game.restore(game.snapshot());
    await pillowLead(game.services.quests, new AbortController().signal);
    assert.deepEqual(game.services.quests.read("assembly_programme"), state);
    assert.ok(game.world().simulation!.map!.fixtures.some(fixture => fixture.id === "furn_cart_left"));
  } finally { game.movement.dispose(); }
});

test("guard dialogue progress belongs to the addressed body and survives resume", async () => {
  const game = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    services: { disclosure: { disclose: async () => [] }, ai: { decisions: async (_input, questions) =>
      Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id === "distraction-proposed" ? "hit" : "miss", probabilities: {} }])) } },
    strategies: { conversation: { respond: async () => ({ role: "assistant", content: "What needs investigating?" }) } },
  });
  try {
    await game.checkedTalkToCharacter("palace-guard-1", "Please investigate a disturbance.");
    const first = game.services.quests.read("conversation-palace-guard-cart-palace-guard-1");
    assert.equal(first.currentStageId, "assessing");
    assert.equal(game.services.quests.read("conversation-palace-guard-cart-palace-guard-2").currentStageId, "on-duty");
    game.restore(game.snapshot());
    assert.deepEqual(game.services.quests.read(first.quest!.id), first);
    assert.deepEqual((game.view().activeQuests as { title: string }[]).map(quest => quest.title), ["Talk to King Aldren"]);
  } finally { game.movement.dispose(); }
});
