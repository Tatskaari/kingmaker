import assert from "node:assert/strict";
import test from "node:test";
import { clone, create } from "@bufbuild/protobuf";
import { InventorySchema, MapStateSchema } from "../packages/contracts/src/index.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { worldForCharacter, worldViewJson } from "../packages/core/src/physical-view.js";
import { renderWorldPrompt } from "../packages/core/src/world-prompt.js";

function physicalState() {
  const map = create(MapStateSchema, {
    actors: [{ characterId: "visitor", roomId: "hall" }, { characterId: "guard", roomId: "hall" }],
    rooms: [{ id: "hall", name: "Hall", inventory: { items: [{ id: "hidden", name: "Hidden", concealed: true }] } }],
    fixtures: [{ id: "chest", name: "Chest", revealedName: "Secret chest", requiredKeyId: "key",
      roomId: "hall", container: true, examinedBy: ["guard"], searchedBy: ["guard"],
      inventory: { items: [{ id: "letter", name: "Letter", details: "Secret instructions", concealed: true }] } }],
  });
  const guard = { id: "guard", inventory: create(InventorySchema, { items: [{ id: "sword", name: "Sword", concealed: true }] }) };
  return { map, owners: inventoryOwners([{ id: "visitor" }, guard], map) };
}

test("physical views filter ownership and discovery without character or scenario protos", () => {
  const { map, owners } = physicalState();
  const before = clone(MapStateSchema, map);
  const visitor = worldForCharacter(map, owners, "visitor");
  assert.doesNotMatch(JSON.stringify(worldViewJson(visitor)), /sword|Secret instructions|Secret chest|hidden/);
  assert.equal(visitor.fixtures[0]!.requiredKeyId, "");
  assert.deepEqual(visitor.fixtures[0]!.examinedBy, []);
  assert.deepEqual(visitor.fixtures[0]!.searchedBy, []);
  const guard = worldForCharacter(map, owners, "guard");
  assert.deepEqual(guard.objects.map(item => item.id).sort(), ["letter", "sword"]);
  assert.equal(guard.fixtures[0]!.requiredKeyId, "key");
  assert.equal(guard.fixtures[0]!.revealedName, "Secret chest");
  assert.deepEqual(map, before, "Reading an observation leaves physical state unchanged");
  map.fixtures[0]!.open = true;
  const opened = worldForCharacter(map, owners, "visitor");
  assert.deepEqual(opened.objects.map(item => item.id), ["letter"]);
  assert.equal(map.fixtures[0]!.inventory!.items.length, 1);
});

test("world descriptions require only a filtered map and display names", () => {
  const { map, owners } = physicalState();
  const view = worldForCharacter(map, owners, "visitor");
  const prompt = renderWorldPrompt([{ id: "visitor", name: "Visiting Envoy" }], view, "visitor");
  assert.match(prompt, /Visiting Envoy/);
  assert.match(prompt, /\["guard","guard"/, "Unknown display names fall back to the stable ID");
  assert.doesNotMatch(prompt, /Secret instructions|Secret chest|sword|hidden/);
});
