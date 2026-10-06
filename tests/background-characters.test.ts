import { inventoryOwners } from "../packages/core/src/inventory.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { DocumentSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { loadPlayableWorld } from "./fixtures.js";
import { placeBackgroundCharacters } from "../apps/web/src/background-characters.js";
import { physicalFixture } from "./fixtures.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { courtMarkers } from "../apps/web/src/court-map.js";

function backgroundWorld() {
  const world = loadPlayableWorld(), path = "Scenarios/Centennial Assembly/Characters/test-guard/character.md";
  for (const entry of world.characters) if (world.docs[entry]!.frontmatter?.background) world.docs[entry]!.frontmatter!.background = false;
  world.simulation!.map!.actors = world.simulation!.map!.actors.filter(actor => !actor.instanceId);
  world.docs[path] = create(DocumentSchema, { body: "Shared memory", frontmatter: { background: true, name: "Guard", active_goal: "Wander off",
    placements: [{ x: 59, y: 35 }, { x: 44, y: 34 }] } });
  world.docs[world.scenario]!.body += `\n[[${path}]]`;
  world.characters.push(path);
  placeBackgroundCharacters(world);
  return world;
}

test("background bodies share lore, survive saves and keep independent runtime identities", () => {
  const world = backgroundWorld();
  const game = new WorldHost(fromJson(WorldStateSchema, toJson(WorldStateSchema, world)));
  const bodies = game.world().simulation!.map!.actors.filter(actor => actor.characterId.startsWith("test-guard-"));
  assert.deepEqual(bodies.map(actor => actor.instanceId), ["test-guard-1", "test-guard-2"]);
  assert.equal(game.world().characters.filter(path => path.includes("/test-guard/")).length, 1);
  const characters = game.view().characters as Parameters<typeof courtMarkers>[0];
  const markers = courtMarkers(characters).filter(marker => marker.id.startsWith("test-guard-"));
  assert.equal(markers.length, 2);
  assert.ok(markers.every(marker => marker.point));
  assert.notDeepEqual(markers[0]!.point, markers[1]!.point);
  assert.equal(game.hasActiveObjective("test-guard"), false);
  const player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  player.position!.x = 44; player.position!.y = 35;
  assert.equal(physicalFixture(world).world!.actors.find(actor => actor.characterId === "test-guard-2")!.position!.x, 44);
  assert.equal(world.simulation!.map!.actors.find(actor => actor.characterId.startsWith("test-guard-"))!.instanceId, "test-guard-1");
});

test("invalid or overlapping template placements fail before starting a game", () => {
  const world = backgroundWorld();
  assert.throws(() => placeBackgroundCharacters(world), /Invalid background placements/);
  world.simulation!.map!.actors = world.simulation!.map!.actors.filter(actor => !actor.characterId.startsWith("test-guard-"));
  const path = world.characters.find(path => path.includes("/test-guard/"))!;
  world.docs[path]!.frontmatter!.placements = [{ x: 0, y: 0 }];
  assert.throws(() => placeBackgroundCharacters(world), /Blocked background position/);
});

test("paired bodies offer independent talk actions, listeners and movement", async () => {
  const { roomAgentActions } = await import("../apps/web/src/room-actions.js");
  const { courtCharactersWithinEarshot } = await import("../apps/web/src/earshot.js");
  const world = backgroundWorld(), bodies = world.simulation!.map!.actors.filter(actor => actor.characterId.startsWith("test-guard-"));
  bodies[1]!.position = { ...bodies[0]!.position!, x: 60 }; bodies[1]!.roomId = bodies[0]!.roomId;
  const player = world.simulation!.map!.actors.find(actor => actor.characterId === "player")!;
  player.position = { ...bodies[0]!.position!, x: 61 }; player.roomId = bodies[0]!.roomId;
  const scenario = physicalFixture(world);
  assert.equal(roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "player").filter(action => action.target.startsWith("test-guard-")).length, 2);
  assert.ok(roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "test-guard-1").length > 0);
  assert.equal(courtCharactersWithinEarshot({ id: "player", name: "Player", position: player.position },
    bodies.map(body => ({ id: body.characterId, name: "Guard", position: body.position }))).length, 2);
});

test("the palace has ten identical brothers in five pairs", () => {
  const world = loadPlayableWorld();
  const bodies = world.simulation!.map!.actors.filter(actor => actor.characterId.startsWith("palace-guard-"));
  assert.equal(bodies.length, 10);
  assert.equal(new Set(bodies.map(actor => actor.instanceId)).size, 10);
  const rooms = new Map<string, number>();
  for (const body of bodies) rooms.set(body.roomId, (rooms.get(body.roomId) ?? 0) + 1);
  assert.deepEqual([...rooms.values()], [2, 2, 2, 2, 2]);
  const voice = world.docs["Cast/Caerwyn/Palace Guards/private.md"]!.body;
  assert.match(voice, /identical decuplet/);
  assert.match(voice, /\*sniff\* whatareyoutalkinabeet/);
});
