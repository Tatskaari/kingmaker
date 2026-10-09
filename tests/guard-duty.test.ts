import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld } from "./fixtures.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { create } from "@bufbuild/protobuf";
import { DocumentSchema, type WorldState } from "../packages/contracts/src/v2.js";
import { activityGoal } from "../packages/lore/src/activity.js";

const guard = "palace-guard-9";
function assignInvestigation(world: WorldState) {
  const character = world.simulation!.runtimeCharacters[guard]!;
  character.activity = character.document.replace("character.md", "test-investigation.md");
  world.docs[character.activity] = create(DocumentSchema, { frontmatter: {
    visibility: "private", readers: ["character:palace-guard"], name: "Investigate intrusion",
    status: "An intrusion was perceived.", success_criteria: "The intrusion has been investigated.",
    current_goal: "Investigate the perceived intrusion into the royal bedchamber.",
  } });
}

test("guards start idle without generated duty or wait documents", () => {
  const world = loadPlayableWorld();
  const guards = Object.values(world.simulation!.runtimeCharacters).filter(character => character.characterId === "palace-guard");
  assert.equal(guards.length, 10);
  const game = new WorldGameRuntime(world, "");
  for (const character of guards) {
    assert.equal(character.activity, undefined);
    assert.equal(character.wait, undefined);
    assert.equal(game.hasActiveObjective(character.id), false);
  }
  assert.ok(!game.waitingCharacters().some(id => id.startsWith("palace-guard-")));
  assert.ok(!Object.keys(world.docs).some(path => /palace-guard\/(activity|routine)-/.test(path)));
});

test("a guard assigned an investigation can move independently", async () => {
  const world = loadPlayableWorld();
  assignInvestigation(world);
  world.simulation!.map!.doors.filter(door => door.roomIds.includes("royal_bedchamber")).forEach(door => { door.open = true; });
  const game = new WorldGameRuntime(world, "");
  assert.ok(game.hasActiveObjective(guard));
  assert.ok(game.map.observe(guard).actions.some(action => action.type === "move"));
  const before = game.world().simulation!.map!.actors.find(actor => actor.characterId === "palace-guard-10")!.position;
  const move = game.map.observe(guard).actions.find(action => action.type === "move")!;
  await game.stepNpcAction(guard, move.id, activityGoal(world, guard)!);
  assert.deepEqual(game.world().simulation!.map!.actors.find(actor => actor.characterId === "palace-guard-10")!.position, before);
});

test("private room entry emits evidence, while permitted entry does not", async () => {
  for (const permitted of [false, true]) {
    const world = loadPlayableWorld(), player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
    player.position = { ...player.position!, x: 62, y: 11 }; player.roomId = "north_corridor";
    world.simulation!.map!.doors.filter(door => door.roomIds.includes("royal_bedchamber")).forEach(door => { door.open = true; });
    if (permitted) world.simulation!.map!.rooms.find(room => room.id === "royal_bedchamber")!.allowedCharacterIds.push("player");
    const game = new WorldGameRuntime(world, "");
    const result = await game.executeAction({ command: { kind: "move", destination: { x: 62, y: 8 } } });
    assert.equal(!!result.worldEvent, !permitted);
    if (!permitted) assert.match(result.worldEvent!.summary, /Royal Bedchamber without permission/);
  }
});

test("a guard opening challenges the player instead of arresting without a defense", async () => {
  const world = loadPlayableWorld(), player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  player.position = { ...player.position!, x: 61, y: 11 }; player.roomId = "north_corridor";
  assignInvestigation(world);
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal), } },
    services: { ai: { responses: async request => request.tools?.some(tool => tool.function.name === "arrest")
      ? { role: "assistant", content: null, tool_calls: [{ id: "arrest", type: "function", function: { name: "arrest", arguments: "{}" } }] }
      : { role: "assistant", content: "You're in the royal bedchamber. Explain yourself." } } },
  });
  const result = await game.initiatePlayerConversation(guard, "talk_player", world.simulation!.map!.revision, activityGoal(world, guard)!, new AbortController().signal);
  assert.equal(result.ok, true);
  assert.equal(game.snapshot().jail, undefined);
  assert.equal(game.snapshot().arrestChallenges?.[guard], true);
  assert.equal(game.snapshot().conversationEndRequested?.[guard], undefined);
});
