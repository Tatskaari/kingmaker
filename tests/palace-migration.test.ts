import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromJsonString, toJson } from "@bufbuild/protobuf";
import { ScenarioSchema, TilePositionSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { migratePalaceWings } from "../apps/web/src/palace-migration.js";

const load = () => fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));

test("old palace saves relocate entities and door approaches without resetting progress", () => {
  const current = load(), saved = load(), world = saved.world!;
  world.rooms = world.rooms.filter(room => !["west_wing", "dining_hall"].includes(room.id));
  // These positions exercise central rooms, both delegations and old passage thresholds.
  const positions = [["corvin", "corvin_chamber", 5, 5, 51, 5],
    ["mara", "mara_chamber", 53, 7, 24, 7],
    ["elinor", "greenweald_back_hall", 58, 28, 19, 28],
    ["lucan", "lucan_chamber", 53, 37, 99, 7],
    ["hadrik", "palace_back_hall", 35, 13, 42, 13],
    ["rook", "palace_back_hall", 33, 43, 79, 30]] as const;
  world.actors = positions.map(([id, roomId, x, y]) => ({ ...world.actors.find(actor => actor.characterId === id)!,
    roomId, position: create(TilePositionSchema, { x, y }) }));
  const fixture = world.fixtures[0]!;
  world.fixtures = [fixture];
  fixture.position = create(TilePositionSchema, { x: 6, y: 4 });
  fixture.interactionSpot = create(TilePositionSchema, { x: 6, y: 5 });
  fixture.open = true;
  world.doors[0]!.open = true;
  saved.characters[0]!.lore = "Remembers the player's promise.";
  const beforeInventory = structuredClone(fixture.inventory);
  migratePalaceWings(saved, current);
  for (const [id, , , , x, y] of positions) assert.deepEqual(world.actors.find(actor => actor.characterId === id)!.position,
    create(TilePositionSchema, { x, y }));
  assert.equal(world.actors.find(actor => actor.characterId === "hadrik")!.roomId, "west_wing");
  assert.equal(fixture.position!.x, 52);
  assert.equal(fixture.interactionSpot!.x, 52);
  assert.equal(fixture.open, true);
  assert.deepEqual(fixture.inventory, beforeInventory);
  assert.equal(world.doors[0]!.open, true);
  assert.deepEqual(world.doors[0]!.tiles, current.world!.doors[0]!.tiles);
  assert.equal(saved.characters[0]!.lore, "Remembers the player's promise.");
  const upgraded = structuredClone(saved);
  migratePalaceWings(saved, current);
  assert.deepEqual(saved, upgraded, "migration runs only once");
});

test("runtime restore upgrades an old snapshot and subsequent restores keep coordinates stable", () => {
  const current = load(), runtime = new BrowserGameRuntime(current, "test");
  const snapshot = runtime.snapshot(), saved = load();
  saved.world!.rooms = saved.world!.rooms.filter(room => !["west_wing", "dining_hall"].includes(room.id));
  saved.world!.actors = [{ ...saved.world!.actors[0]!, position: create(TilePositionSchema, { x: 5, y: 5 }) }];
  saved.world!.fixtures = []; saved.courtArrivalPlacements = [];
  snapshot.scenario = toJson(ScenarioSchema, saved);
  runtime.restore(snapshot);
  const upgraded = runtime.snapshot();
  assert.equal((upgraded.scenario as any).world.actors[0].position.x, 51);
  runtime.restore(upgraded);
  assert.deepEqual(runtime.snapshot(), upgraded);
});
