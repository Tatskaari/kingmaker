import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { characterIntent, followingTarget } from "../packages/lore/src/activity.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";

function fixture(choice = "continue") {
  const world = loadPlayableWorld(), id = "corvin", goal = "Accompany the player to the parlour.";
  assignActivity(world, id, goal);
  const actor = world.simulation!.map!.actors.find(actor => actor.characterId === id)!;
  const player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  player.roomId = actor.roomId; player.position = { ...actor.position!, x: actor.position!.x + 3 };
  let decisions = 0;
  const options = { services: { disclosure: { disclose: async () => [] }, ai: {
    decisions: async (state: unknown) => {
      decisions++;
      assert.match(JSON.stringify(state), /follow_target/);
      assert.match(JSON.stringify(state), /Accompany the player/);
      return { waiting: { choice, probabilities: {} } };
    }, responses: async () => { throw new Error("Following should not call an LLM."); },
  } } };
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, options);
  return { world, game, goal, options, decisions: () => decisions };
}

test("Follow is offered on visible characters and commits a saved wait without model calls", async () => {
  const { game, goal, decisions, world, options } = fixture();
  const before = characterIntent(game.world(), "corvin");
  const actions = game.map.observe("corvin").actions;
  assert.ok(actions.some(action => action.id === "follow_player"));
  assert.ok(!actions.some(action => action.id === "follow_corvin"));
  await game.stepNpcAction("corvin", "follow_player", goal);
  assert.equal(decisions(), 0);
  assert.equal(game.hasActiveObjective("corvin"), false);
  const intent = characterIntent(game.world(), "corvin");
  assert.equal(intent.activity, null);
  assert.equal(followingTarget(game.world(), "corvin"), "player");
  assert.deepEqual(game.world().docs[intent.wait!]!.frontmatter?.activities, [before.activity]);
  const restored = new WorldGameRuntime(world, "", game.snapshot(), undefined, undefined, options);
  assert.equal(followingTarget(restored.world(), "corvin"), "player");
  assert.equal(restored.followingCharacters().size, 1);
  await restored.checkWait("corvin", 15);
  assert.equal(decisions(), 1);
  assert.equal(followingTarget(restored.world(), "corvin"), "player");
});

test("a Jev wake can resume the original activity and end automatic following", async () => {
  const { world, goal } = fixture();
  const activity = characterIntent(world, "corvin").activity!;
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: {
    disclosure: { disclose: async () => [] }, ai: { decisions: async () => ({ waiting: {
      choice: `set_activity:${activity}`, probabilities: {},
    } }) },
  } });
  await game.beginFollowing("corvin", "follow_player", goal, new AbortController().signal);
  await game.checkWait("corvin", 15);
  assert.equal(characterIntent(game.world(), "corvin").activity, activity);
  assert.equal(followingTarget(game.world(), "corvin"), undefined);
  assert.equal(game.followingCharacters().size, 0);
});

test("a changed goal or absent target cannot start following", async () => {
  const { game, goal } = fixture();
  await assert.rejects(game.beginFollowing("corvin", "follow_player", "old goal", new AbortController().signal), /changed/);
  await assert.rejects(game.beginFollowing("corvin", "follow_missing", goal, new AbortController().signal), /changed/);
  assert.equal(followingTarget(game.world(), "corvin"), undefined);
});
