import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { DocumentSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { loadPlayableWorld } from "./fixtures.js";
import { placeBackgroundCharacters } from "../apps/web/src/background-characters.js";
import { projectWorld } from "../apps/web/src/world-projection.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { courtMarkers } from "../apps/web/src/court-map.js";

function backgroundWorld() {
  const world = loadPlayableWorld(), path = "Scenarios/Centennial Assembly/Characters/test-guard/character.md";
  world.docs[path] = create(DocumentSchema, { body: "Shared memory", frontmatter: { background: true, name: "Guard", active_goal: "Wander off",
    placements: [{ x: 59, y: 35 }, { x: 44, y: 34 }] } });
  world.docs[world.scenario]!.body += `\n[[${path}]]`;
  world.characters.push(path);
  placeBackgroundCharacters(world);
  return world;
}

test("background bodies share one identity, survive saves and stay independently visible", () => {
  const world = backgroundWorld();
  const game = new WorldHost(fromJson(WorldStateSchema, toJson(WorldStateSchema, world)));
  const bodies = game.world().map!.actors.filter(actor => actor.characterId === "test-guard");
  assert.deepEqual(bodies.map(actor => actor.instanceId), ["test-guard-1", "test-guard-2"]);
  assert.equal(game.world().characters.filter(path => path.includes("/test-guard/")).length, 1);
  const characters = game.view().characters as Parameters<typeof courtMarkers>[0];
  const markers = courtMarkers(characters).filter(marker => marker.id === "test-guard");
  assert.equal(markers.length, 2);
  assert.ok(markers.every(marker => marker.point));
  assert.notDeepEqual(markers[0]!.point, markers[1]!.point);
  assert.equal(game.hasActiveObjective("test-guard"), false);
  const player = world.map!.actors.find(actor => actor.characterId === "player")!;
  player.position!.x = 44; player.position!.y = 35;
  assert.equal(projectWorld(world).world!.actors.find(actor => actor.characterId === "test-guard")!.instanceId, "test-guard-2");
  assert.equal(world.map!.actors.find(actor => actor.characterId === "test-guard")!.instanceId, "test-guard-1");
});

test("invalid or overlapping template placements fail before starting a game", () => {
  const world = backgroundWorld();
  assert.throws(() => placeBackgroundCharacters(world), /Invalid background placements/);
  world.map!.actors = world.map!.actors.filter(actor => actor.characterId !== "test-guard");
  const path = world.characters.find(path => path.includes("/test-guard/"))!;
  world.docs[path]!.frontmatter!.placements = [{ x: 0, y: 0 }];
  assert.throws(() => placeBackgroundCharacters(world), /Blocked background position/);
});
