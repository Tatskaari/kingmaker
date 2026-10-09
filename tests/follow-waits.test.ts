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

test("automatic pursuit moves without AI and cancellation stops at the current position", async () => {
  const { world, goal } = fixture();
  let now = 0;
  const timers = new Set<{ at: number; callback(): void }>();
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    movementClock: { now: () => now, schedule(callback, delay) {
      const timer = { at: now + delay, callback }; timers.add(timer); return () => { timers.delete(timer); };
    } },
    services: { ai: { decisions: async () => assert.fail("Movement must not call Jev") } },
  });
  await game.beginFollowing("corvin", "follow_player", goal, new AbortController().signal);
  const documents = game.world().docs, controller = new AbortController();
  const moving = game.moveFollower("corvin", controller.signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  const actor = () => game.world().simulation!.map!.actors.find(actor => actor.characterId === "corvin")!;
  assert.ok(actor().movement);
  const start = { x: actor().position!.x, y: actor().position!.y };
  now = 50; controller.abort(); await moving;
  assert.equal(actor().movement, undefined);
  assert.notDeepEqual({ x: actor().position!.x, y: actor().position!.y }, start);
  assert.strictEqual(game.world().docs, documents);
  const next = game.moveFollower("corvin", new AbortController().signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  now = 1000;
  for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback(); }
  await next;
  const player = game.world().simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  assert.equal(Math.abs(actor().position!.x - player.position!.x) + Math.abs(actor().position!.y - player.position!.y), 1);
  assert.equal(actor().movement, undefined);
  assert.strictEqual(game.world().docs, documents);
});
