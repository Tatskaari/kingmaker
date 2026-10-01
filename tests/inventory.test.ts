import assert from "node:assert/strict";
import test from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { inventoryFor, itemsFor, locatedItems, transferItem, validateInventories } from "../packages/core/src/inventory.js";
import { worldForCharacter, worldViewJson } from "../packages/core/src/context.js";

function example() {
  return create(ScenarioSchema, {
    characters: [{ id: "guard", inventory: {
      items: [{ id: "sword", name: "Sword", definitionId: "longsword", quantity: 1, concealed: true }],
      equipment: { mainHandItemId: "sword", attunedItemIds: ["sword"] },
    } }, { id: "visitor" }],
    world: { fixtures: [{ id: "chest", container: true, inventory: {
      items: [{ id: "letter", name: "Letter", details: "Secret instructions", concealed: true }],
    } }], rooms: [{ id: "hall" }] },
  });
}

test("transfers preserve item identity, clear equipment, and survive serialization", () => {
  const scenario = example(), sword = itemsFor(scenario, "guard")[0]!;
  assert.throws(() => transferItem(scenario, "sword", "missing"), /Unknown inventory owner/);
  assert.equal(itemsFor(scenario, "guard")[0], sword);
  assert.equal(transferItem(scenario, "sword", "chest"), sword);
  assert.equal(itemsFor(scenario, "guard").length, 0);
  assert.equal(inventoryFor(scenario, "guard").equipment!.mainHandItemId, "");
  assert.deepEqual(inventoryFor(scenario, "guard").equipment!.attunedItemIds, []);
  transferItem(scenario, "sword", "visitor");
  transferItem(scenario, "sword", "visitor");
  transferItem(scenario, "sword", "hall");
  assert.equal(locatedItems(scenario).filter(item => item.id === "sword").length, 1);
  const saved = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  assert.equal(itemsFor(saved, "hall")[0]!.definitionId, "longsword");
  assert.ok(!("locationId" in itemsFor(saved, "hall")[0]!));
  assert.ok(!("objects" in saved.world!));
  validateInventories(saved);
});

test("private inventories and unopened contents stay out of every world projection", () => {
  const scenario = example();
  const view = () => JSON.stringify(worldViewJson(worldForCharacter(scenario, "visitor")));
  assert.doesNotMatch(view(), /sword|Secret instructions/);
  assert.match(JSON.stringify(worldViewJson(worldForCharacter(scenario, "guard"))), /sword/);
  scenario.world!.fixtures[0]!.open = true;
  assert.match(view(), /Secret instructions/);
  assert.equal(itemsFor(scenario, "chest").length, 1, "Projection does not mutate source");
});

test("duplicate ownership and equipment outside the holder's inventory are rejected", () => {
  const scenario = example();
  inventoryFor(scenario, "visitor").items.push(itemsFor(scenario, "guard")[0]!);
  assert.throws(() => validateInventories(scenario), /Duplicate/);
  inventoryFor(scenario, "visitor").items = [];
  inventoryFor(scenario, "guard").equipment!.armorItemId = "letter";
  assert.throws(() => validateInventories(scenario), /not carried/);
});
