import assert from "node:assert/strict";
import test from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { inventoryOwners, inventoryFor, itemsFor, locatedItems, transferItem, validateInventories } from "../packages/core/src/inventory.js";
import { worldForCharacter, worldViewJson } from "../packages/core/src/physical-view.js";

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
  const scenario = example(), sword = itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard")[0]!;
  assert.throws(() => transferItem(inventoryOwners(scenario.characters, scenario.world), "sword", "missing"), /Unknown inventory owner/);
  assert.equal(itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard")[0], sword);
  assert.equal(transferItem(inventoryOwners(scenario.characters, scenario.world), "sword", "chest"), sword);
  assert.equal(itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard").length, 0);
  assert.equal(inventoryFor(inventoryOwners(scenario.characters, scenario.world), "guard").equipment!.mainHandItemId, "");
  assert.deepEqual(inventoryFor(inventoryOwners(scenario.characters, scenario.world), "guard").equipment!.attunedItemIds, []);
  transferItem(inventoryOwners(scenario.characters, scenario.world), "sword", "visitor");
  transferItem(inventoryOwners(scenario.characters, scenario.world), "sword", "visitor");
  transferItem(inventoryOwners(scenario.characters, scenario.world), "sword", "hall");
  assert.equal(locatedItems(inventoryOwners(scenario.characters, scenario.world)).filter(item => item.id === "sword").length, 1);
  const saved = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  assert.equal(itemsFor(inventoryOwners(saved.characters, saved.world), "hall")[0]!.definitionId, "longsword");
  assert.ok(!("locationId" in itemsFor(inventoryOwners(saved.characters, saved.world), "hall")[0]!));
  assert.ok(!("objects" in saved.world!));
  validateInventories(inventoryOwners(saved.characters, saved.world));
});

test("private inventories and unopened contents stay out of every world projection", () => {
  const scenario = example();
  const view = () => JSON.stringify(worldViewJson(worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "visitor")));
  assert.doesNotMatch(view(), /sword|Secret instructions/);
  assert.match(JSON.stringify(worldViewJson(worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "guard"))), /sword/);
  scenario.world!.fixtures[0]!.open = true;
  assert.match(view(), /Secret instructions/);
  assert.equal(itemsFor(inventoryOwners(scenario.characters, scenario.world), "chest").length, 1, "Projection does not mutate source");
});

test("duplicate ownership and equipment outside the holder's inventory are rejected", () => {
  const scenario = example();
  inventoryFor(inventoryOwners(scenario.characters, scenario.world), "visitor").items.push(itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard")[0]!);
  assert.throws(() => validateInventories(inventoryOwners(scenario.characters, scenario.world)), /Duplicate/);
  inventoryFor(inventoryOwners(scenario.characters, scenario.world), "visitor").items = [];
  inventoryFor(inventoryOwners(scenario.characters, scenario.world), "guard").equipment!.armorItemId = "letter";
  assert.throws(() => validateInventories(inventoryOwners(scenario.characters, scenario.world)), /not carried/);
});

test("authored court builds have bounded stats, valid health, and uniquely carried equipment", async () => {
  const { readFileSync } = await import("node:fs");
  const { fromJsonString } = await import("@bufbuild/protobuf");
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  validateInventories(inventoryOwners(scenario.characters, scenario.world));
  for (const character of scenario.characters) {
    const dnd = character.dnd!;
    assert.ok(dnd?.abilityScores, character.id);
    const { strength, dexterity, constitution, intelligence, wisdom, charisma } = dnd.abilityScores;
    for (const score of [strength, dexterity, constitution, intelligence, wisdom, charisma]) assert.ok(score >= 8 && score <= 16);
    assert.ok(dnd.classes.length > 0);
    assert.ok(dnd.classes.every(entry => entry.level >= 1 && entry.level <= 3));
    assert.ok(dnd.hitPoints!.maximum > 0);
    assert.equal(dnd.hitPoints!.current, dnd.hitPoints!.maximum);
    assert.ok(character.inventory!.equipment!.mainHandItemId);
    assert.ok(character.inventory!.items.every(item => (item.quantity ?? 1) > 0));
  }
  const corvin = scenario.characters.find(character => character.id === "corvin")!;
  assert.equal(corvin.dnd!.classes[0]!.classId, "wizard");
  assert.ok(corvin.dnd!.spellcasting!.preparedSpellIds.includes("detect-magic"));
  assert.ok(itemsFor(inventoryOwners(scenario.characters, scenario.world), "rook").some(item => item.id === "rook_tomas_letter"), "Plot evidence is retained");
  const saved = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  assert.deepEqual(saved.characters.map(character => character.dnd), scenario.characters.map(character => character.dnd));
});

test("inventory operations accept plain owners without a scenario or character proto", async () => {
  const { InventorySchema } = await import("../packages/contracts/src/index.js");
  const owners: import("../packages/core/src/inventory.js").InventoryOwner[] = [
    { id: "traveller", inventory: create(InventorySchema, { items: [{ id: "coin", name: "Coin" }] }) },
    { id: "recipient" },
  ];
  const coin = itemsFor(owners, "traveller")[0]!;
  transferItem(owners, "coin", "recipient");
  assert.equal(owners[1]!.inventory!.items[0], coin);
  assert.equal(itemsFor(owners, "traveller").length, 0);
  assert.deepEqual(locatedItems(owners).map(({ id, locationId }) => ({ id, locationId })),
    [{ id: "coin", locationId: "recipient" }]);
  validateInventories(owners);
});
