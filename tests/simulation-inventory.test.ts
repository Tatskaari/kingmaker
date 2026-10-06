import { Client } from "boardgame.io/client";
import type { Game } from "boardgame.io";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";
import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { InventorySchema, ItemInstanceSchema } from "../packages/contracts/src/index.js";
import { SimulationStateSchema, type SimulationState } from "../packages/contracts/src/v2.js";
import { addToInventory, removeFromInventory, replaceInventories, transferBetweenInventories } from "../packages/core/src/simulation-inventory.js";

function example() {
  return create(SimulationStateSchema, { runtimeCharacters: {
    guard: { id: "guard", inventory: { items: [{ id: "sword", concealed: true }], equipment: {
      mainHandItemId: "sword", attunedItemIds: ["sword"],
    } } }, visitor: { id: "visitor" },
  }, map: { fixtures: [{ id: "chest" }], rooms: [{ id: "hall" }] } });
}

test("simulation transfers clear equipment and preserve unrelated state", () => {
  let G = example(), guard = G.runtimeCharacters.guard!, map = G.map!;
  const oldInventory = guard.inventory;
  G = executeLocalMove(G, transferBetweenInventories, "guard", "chest", "sword", { reveal: true });
  assert.notEqual(G.runtimeCharacters.guard, guard);
  assert.notEqual(G.map, map);
  assert.equal(G.map!.rooms, map.rooms);
  assert.equal(oldInventory!.items.length, 1, "previous reads stay unchanged");
  assert.equal(G.runtimeCharacters.guard!.inventory!.equipment!.mainHandItemId, "");
  assert.deepEqual(G.runtimeCharacters.guard!.inventory!.equipment!.attunedItemIds, []);
  assert.equal(G.map!.fixtures[0]!.inventory!.items[0]!.concealed, false);
  G = executeLocalMove(G, transferBetweenInventories, "chest", "hall", "sword");
  G = executeLocalMove(G, transferBetweenInventories, "hall", "visitor", "sword");
  assert.equal(G.runtimeCharacters.visitor!.inventory!.items[0]!.id, "sword");
});

test("failed commands publish neither partial edits nor empty inventories", () => {
  let G = example(), before = G.runtimeCharacters.guard!.inventory;
  assert.throws(() => executeLocalMove(G, transferBetweenInventories, "guard", "missing", "sword"), /Invalid simulation move/);
  assert.throws(() => executeLocalMove(G, transferBetweenInventories, "guard", "visitor", "missing"), /Invalid simulation move/);
  assert.throws(() => executeLocalMove(G, transferBetweenInventories, "guard", "guard", "sword"), /Invalid simulation move/);
  assert.throws(() => executeLocalMove(G, addToInventory, "visitor", create(ItemInstanceSchema, { id: "sword" })), /Invalid simulation move/);
  assert.equal(G.runtimeCharacters.guard!.inventory, before);
  assert.equal(G.runtimeCharacters.visitor!.inventory, undefined);
  const invalid = create(InventorySchema, { items: [{ id: "coin", quantity: 0 }] });
  assert.throws(() => executeLocalMove(G, replaceInventories, [
    { ownerId: "guard", inventory: create(InventorySchema) }, { ownerId: "visitor", inventory: invalid },
  ]), /Invalid simulation move/);
  assert.equal(G.runtimeCharacters.guard!.inventory, before);
});

test("added and replaced inventory inputs cannot mutate published state", () => {
  let G = example(), item = create(ItemInstanceSchema, { id: "coin" });
  G = executeLocalMove(G, addToInventory, "visitor", item);
  item.name = "Changed";
  assert.equal(G.runtimeCharacters.visitor!.inventory!.items[0]!.name, "");
  const replacement = create(InventorySchema, { items: [{ id: "letter" }] });
  G = executeLocalMove(G, replaceInventories, [{ ownerId: "visitor", inventory: replacement }]);
  replacement.items.length = 0;
  assert.equal(G.runtimeCharacters.visitor!.inventory!.items.length, 1);
  G = executeLocalMove(G, removeFromInventory, "guard", "sword");
  assert.deepEqual(G.runtimeCharacters.guard!.inventory!.equipment!.attunedItemIds, []);
  assert.throws(() => executeLocalMove(G, removeFromInventory, "guard", "letter"), /Invalid simulation move/);
});

test("inventory functions register unchanged as boardgame.io moves", () => {
  const game: Game<SimulationState> = { setup: example, moves: {
    addToInventory, removeFromInventory, transferBetweenInventories, replaceInventories,
  } };
  const client = Client({ game });
  client.moves.transferBetweenInventories!("guard", "chest", "sword", { reveal: true });
  const local = executeLocalMove(example(), transferBetweenInventories, "guard", "chest", "sword", { reveal: true });
  assert.deepEqual(client.getState()!.G, local);
  client.moves.addToInventory!("visitor", create(ItemInstanceSchema, { id: "coin" }));
  client.moves.removeFromInventory!("visitor", "coin");
  const before = client.getState()!.G;
  client.moves.replaceInventories!([
    { ownerId: "guard", inventory: create(InventorySchema, { items: [{ id: "new" }] }) },
    { ownerId: "visitor", inventory: create(InventorySchema, { items: [{ id: "sword" }] }) },
  ]);
  assert.deepEqual(client.getState()!.G, before, "rejected batch discards even its valid first edit");
  client.moves.replaceInventories!([{ ownerId: "visitor", inventory: create(InventorySchema, { items: [{ id: "gift" }] }) }]);
  assert.equal(client.getState()!.G.runtimeCharacters.visitor!.inventory!.items[0]!.id, "gift");
});
