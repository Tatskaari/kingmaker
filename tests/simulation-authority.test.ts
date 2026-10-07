import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { ItemInstanceSchema } from "../packages/contracts/src/index.js";
import { createSimulationAuthority } from "../packages/core/src/simulation-authority.js";
import { addToInventory, removeFromInventory } from "../packages/core/src/simulation-inventory.js";

const fixture = () => create(SimulationStateSchema, { runtimeCharacters: {
  player: { id: "player", characterId: "player", inventory: { items: [] } },
} });

test("boardgame authority publishes accepted moves and rejects without changing state", () => {
  const authority = createSimulationAuthority(fixture());
  const before = authority.read();
  const item = create(ItemInstanceSchema, { id: "coin", name: "Coin", quantity: 1 });
  authority.executeMove(addToInventory, "player", item);
  const accepted = authority.read();
  assert.notEqual(accepted, before);
  assert.equal(before.runtimeCharacters.player!.inventory!.items.length, 0);
  assert.equal(accepted.runtimeCharacters.player!.inventory!.items[0]!.id, "coin");
  assert.throws(() => authority.executeMove(removeFromInventory, "player", "missing"), /Invalid simulation move/);
  assert.equal(authority.read(), accepted);
  assert.throws(() => authority.executeMove(() => undefined), /Unregistered/);
  assert.equal(authority.read(), accepted);
});

test("published simulation records cannot be mutated by readers", () => {
  const authority = createSimulationAuthority(fixture());
  authority.executeMove(addToInventory, "player", create(ItemInstanceSchema, { id: "coin", name: "Coin", quantity: 1 }));
  assert.throws(() => { authority.read().runtimeCharacters.player!.inventory!.items.length = 0; }, TypeError);
  assert.equal(authority.read().runtimeCharacters.player!.inventory!.items.length, 1);
});
