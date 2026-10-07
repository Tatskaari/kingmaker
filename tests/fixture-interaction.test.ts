import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { InventorySchema, MapFixtureSchema } from "../packages/contracts/src/index.js";
import { inventoryOwners, itemsFor, type InventoryOwner } from "../packages/core/src/inventory.js";
import { applyFixtureAction, fixtureActions } from "../packages/core/src/fixtures.js";
import { requireCurrentFixtureAction } from "../apps/web/src/court-interactions.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

function furnishedWorld() {
  const world = loadPlayableWorld();
  const fixture = world.simulation!.map!.fixtures.find(item => item.id === "palace_corvin_drawers")!;
  fixture.open = true;
  world.simulation!.map!.actors.find(actor => actor.characterId === "player")!.position = fixture.interactionSpot;
  return world;
}

test("queued furniture choices reject removed actions and items moved to the player", () => {
  const world = furnishedWorld(), map = world.simulation!.map!;
  const owners = inventoryOwners([{ id: "player", inventory: world.simulation!.runtimeCharacters.player?.inventory }], map);
  const choices = fixtureActions(map.fixtures, owners, "player");
  const take = choices.find(action => action.id === "take_palace_royal_key")!;
  const inspect = choices.find(action => action.id === "inspect_item_palace_royal_key")!;
  requireCurrentFixtureAction(take, choices);
  // A refreshed menu can retain an item's inspect ID with a different location.
  assert.throws(() => requireCurrentFixtureAction(inspect, [{ ...inspect, target: "player" }]), /no longer available/);
  map.fixtures.find(item => item.id === take.target)!.open = false;
  const refreshed = fixtureActions(map.fixtures, owners, "player");
  assert.throws(() => requireCurrentFixtureAction(take, refreshed), /no longer available/);
  assert.throws(() => requireCurrentFixtureAction(inspect, refreshed), /no longer available/);
  const furniture = choices.find(action => action.id === "inspect_palace_corvin_drawers")!;
  requireCurrentFixtureAction(furniture, refreshed);
});

test("repeating a completed furniture action reports an unavailable choice without mutating the world", async () => {
  const runtime = new WorldGameRuntime(furnishedWorld(), "");
  const take = { kind: "fixture" as const, id: "take_palace_royal_key" };
  const result = await runtime.executeAction({ command: take });
  assert.match(result.message!, /Picked up/);
  const before = runtime.world();
  await assert.rejects(runtime.executeAction({ command: take }), /no longer available/);
  assert.deepEqual(runtime.world(), before);
  const inspect = await runtime.executeAction({ command: { kind: "fixture", id: "inspect_item_palace_royal_key" } });
  assert.match(inspect.message!, /Royal lockbox key/);
});


test("fixture rules operate directly on physical fixtures and inventory owners", () => {
  const chest = create(MapFixtureSchema, { id: "chest", name: "Chest", ownerCharacterId: "guard",
    container: true, requiredKeyId: "key", inventory: { items: [{ id: "letter", name: "Letter", concealed: true }] } });
  const visitor: InventoryOwner = { id: "visitor" };
  const owners = [visitor, chest], fixtures = [chest];
  assert.ok(!fixtureActions(fixtures, owners, visitor.id).some(action => action.id === "take_letter"));
  assert.match(applyFixtureAction(fixtures, owners, visitor.id, "open_chest"), /matching key/);
  assert.equal(chest.open, false);
  visitor.inventory = create(InventorySchema, { items: [{ id: "key", name: "Key" }] });
  applyFixtureAction(fixtures, owners, visitor.id, "open_chest");
  assert.equal(fixtureActions(fixtures, owners, visitor.id).find(action => action.id === "take_letter")!.legality, "illegal");
  applyFixtureAction(fixtures, owners, visitor.id, "take_letter");
  assert.deepEqual(itemsFor(owners, visitor.id).map(item => item.id), ["key", "letter"]);
  assert.equal(chest.inventory!.items.length, 0);
  assert.equal(itemsFor(owners, visitor.id)[1]!.concealed, false);
  assert.throws(() => applyFixtureAction(fixtures, owners, visitor.id, "take_letter"), /no longer available/);
});
