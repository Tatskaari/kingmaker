import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { InventorySchema, ItemInstanceSchema } from "../packages/contracts/src/index.js";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { addToInventory, removeFromInventory, replaceInventories, transferBetweenInventories } from "../packages/core/src/simulation-inventory.js";

function example() {
  return create(SimulationStateSchema, { runtimeCharacters: {
    guard: { id: "guard", inventory: { items: [{ id: "sword", concealed: true }], equipment: {
      mainHandItemId: "sword", attunedItemIds: ["sword"],
    } } }, visitor: { id: "visitor" },
  }, map: { fixtures: [{ id: "chest" }], rooms: [{ id: "hall" }] } });
}

test("simulation transfers clear equipment and preserve unrelated state", () => {
  const G = example(), guard = G.runtimeCharacters.guard!, map = G.map!;
  const oldInventory = guard.inventory;
  transferBetweenInventories(G, "guard", "chest", "sword", { reveal: true });
  assert.equal(G.runtimeCharacters.guard, guard);
  assert.equal(G.map, map);
  assert.equal(oldInventory!.items.length, 1, "previous reads stay unchanged");
  assert.equal(guard.inventory!.equipment!.mainHandItemId, "");
  assert.deepEqual(guard.inventory!.equipment!.attunedItemIds, []);
  assert.equal(map.fixtures[0]!.inventory!.items[0]!.concealed, false);
  transferBetweenInventories(G, "chest", "hall", "sword");
  transferBetweenInventories(G, "hall", "visitor", "sword");
  assert.equal(G.runtimeCharacters.visitor!.inventory!.items[0]!.id, "sword");
});

test("failed commands publish neither partial edits nor empty inventories", () => {
  const G = example(), before = G.runtimeCharacters.guard!.inventory;
  assert.throws(() => transferBetweenInventories(G, "guard", "missing", "sword"), /inventory owner/);
  assert.throws(() => transferBetweenInventories(G, "guard", "visitor", "missing"), /not carried/);
  assert.throws(() => transferBetweenInventories(G, "guard", "guard", "sword"), /different owners/);
  assert.throws(() => addToInventory(G, "visitor", create(ItemInstanceSchema, { id: "sword" })), /Duplicate/);
  assert.equal(G.runtimeCharacters.guard!.inventory, before);
  assert.equal(G.runtimeCharacters.visitor!.inventory, undefined);
  const invalid = create(InventorySchema, { items: [{ id: "coin", quantity: 0 }] });
  assert.throws(() => replaceInventories(G, [
    { ownerId: "guard", inventory: create(InventorySchema) }, { ownerId: "visitor", inventory: invalid },
  ]), /Invalid quantity/);
  assert.equal(G.runtimeCharacters.guard!.inventory, before);
});

test("added and replaced inventory inputs cannot mutate published state", () => {
  const G = example(), item = create(ItemInstanceSchema, { id: "coin" });
  addToInventory(G, "visitor", item);
  item.name = "Changed";
  assert.equal(G.runtimeCharacters.visitor!.inventory!.items[0]!.name, "");
  const replacement = create(InventorySchema, { items: [{ id: "letter" }] });
  replaceInventories(G, [{ ownerId: "visitor", inventory: replacement }]);
  replacement.items.length = 0;
  assert.equal(G.runtimeCharacters.visitor!.inventory!.items.length, 1);
  removeFromInventory(G, "guard", "sword");
  assert.deepEqual(G.runtimeCharacters.guard!.inventory!.equipment!.attunedItemIds, []);
  assert.throws(() => removeFromInventory(G, "guard", "letter"), /not carried/);
});
