import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld } from "./fixtures.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { activityGoal } from "../packages/lore/src/activity.js";

const guard = "palace-guard-9";
test("each guard has its own duty and can approach a witnessed intruder", async () => {
  const world = loadPlayableWorld();
  const guards = Object.values(world.runtimeCharacters).filter(character => character.characterId === "palace-guard");
  assert.equal(guards.length, 10);
  assert.equal(new Set(guards.map(character => character.activity)).size, 10);
  const game = new WorldGameRuntime(world, "");
  assert.ok(game.hasActiveObjective(guard));
  assert.ok(game.map.observe(guard).actions.some(action => action.type === "move"));
  const before = game.world().map!.actors.find(actor => actor.characterId === "palace-guard-10")!.position;
  const move = game.map.observe(guard).actions.find(action => action.type === "move")!;
  game.stepNpcAction(guard, move.id, activityGoal(world, guard)!);
  assert.deepEqual(game.world().map!.actors.find(actor => actor.characterId === "palace-guard-10")!.position, before);
});

test("private room entry emits evidence, while permitted entry does not", async () => {
  for (const permitted of [false, true]) {
    const world = loadPlayableWorld(), player = world.map!.actors.find(actor => actor.characterId === "player")!;
    player.position = { ...player.position!, x: 62, y: 11 }; player.roomId = "north_corridor";
    world.map!.doors.filter(door => door.roomIds.includes("royal_bedchamber")).forEach(door => { door.open = true; });
    if (permitted) world.map!.rooms.find(room => room.id === "royal_bedchamber")!.allowedCharacterIds.push("player");
    const game = new WorldGameRuntime(world, "");
    const result = await game.executeAction({ command: { kind: "move", destination: { x: 62, y: 8 } } });
    assert.equal(!!result.worldEvent, !permitted);
    if (!permitted) assert.match(result.worldEvent!.summary, /Royal Bedchamber without permission/);
  }
});

test("a guard can execute arrest when initiating a nearby conversation", async () => {
  const world = loadPlayableWorld(), player = world.map!.actors.find(actor => actor.characterId === "player")!;
  player.position = { ...player.position!, x: 61, y: 11 }; player.roomId = "north_corridor";
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    hooks: { conversation: { classify: async () => ({ docs: {} as never, checks: undefined }), resolve: async () => ({ reclassify: false }) } },
    services: { ai: { responses: async request => request.tools?.some(tool => tool.function.name === "arrest")
      ? { role: "assistant", content: null, tool_calls: [{ id: "arrest", type: "function", function: { name: "arrest", arguments: "{}" } }] }
      : { role: "assistant", content: "You're nicked for breaking into the royal bedchamber." } } },
  });
  const result = await game.initiatePlayerConversation(guard, "talk_player", world.map!.revision, activityGoal(world, guard)!, new AbortController().signal);
  assert.equal(result.ok, true);
  assert.equal(game.snapshot().jail?.characterId, guard);
  assert.equal(game.snapshot().conversationEndRequested?.[guard], true);
});
