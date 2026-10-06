import { transferBetweenInventories } from "../packages/core/src/simulation-inventory.js";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { inventoryFor, inventoryOwners, itemsFor, locatedItems, findItem, validateInventories } from "../packages/core/src/inventory.js";
import { worldForCharacter, worldViewJson } from "../packages/core/src/physical-view.js";
import { physicalFixture } from "./fixtures.js";

function example() {
  const guard = "Scenarios/Test/Characters/guard/character.md", visitor = "Scenarios/Test/Characters/visitor/character.md";
  return physicalFixture(create(WorldStateSchema, { characters: [guard, visitor], simulation: { runtimeCharacters: {
    guard: { id: "guard", characterId: "guard", document: guard, inventory: {
      items: [{ id: "sword", name: "Sword", definitionId: "longsword", quantity: 1, concealed: true }],
      equipment: { mainHandItemId: "sword", attunedItemIds: ["sword"] },
    } },
    visitor: { id: "visitor", characterId: "visitor", document: visitor },
  }, map: { fixtures: [{ id: "chest", container: true, inventory: {
    items: [{ id: "letter", name: "Letter", details: "Secret instructions", concealed: true }],
  } }], rooms: [{ id: "hall" }] } }, docs: { [guard]: {}, [visitor]: {} } }));
}

test("transfers preserve item identity, clear equipment, and survive serialization", () => {
  const scenario = example(), sword = itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard")[0]!;
  assert.throws(() => transferBetweenInventories(scenario.source.simulation!, "guard", "missing", "sword"), /inventory owner/);
  assert.deepEqual(itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard")[0], sword);
  transferBetweenInventories(scenario.source.simulation!, "guard", "chest", "sword");
  assert.equal(itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard").length, 0);
  assert.equal(inventoryFor(inventoryOwners(scenario.characters, scenario.world), "guard").equipment!.mainHandItemId, "");
  assert.deepEqual(inventoryFor(inventoryOwners(scenario.characters, scenario.world), "guard").equipment!.attunedItemIds, []);
  transferBetweenInventories(scenario.source.simulation!, "chest", "visitor", "sword");
  transferBetweenInventories(scenario.source.simulation!, "visitor", "hall", "sword");
  assert.equal(locatedItems(inventoryOwners(scenario.characters, scenario.world)).filter(item => item.id === "sword").length, 1);
  const saved = physicalFixture(fromBinary(WorldStateSchema, toBinary(WorldStateSchema, scenario.source)));
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
  scenario.source.simulation!.runtimeCharacters.visitor!.inventory!.items.push(itemsFor(inventoryOwners(scenario.characters, scenario.world), "guard")[0]!);
  assert.throws(() => validateInventories(inventoryOwners(scenario.characters, scenario.world)), /Duplicate/);
  scenario.source.simulation!.runtimeCharacters.visitor!.inventory!.items = [];
  scenario.source.simulation!.runtimeCharacters.guard!.inventory!.equipment!.armorItemId = "letter";
  assert.throws(() => validateInventories(inventoryOwners(scenario.characters, scenario.world)), /not carried/);
});

test("authored court builds have valid stats, health, and uniquely carried equipment", async () => {
  const scenario = physicalFixture();
  validateInventories(inventoryOwners(scenario.characters, scenario.world));
  for (const character of scenario.characters.filter(character => character.dnd)) {
    const dnd = character.dnd!;
    assert.ok(dnd?.abilityScores, character.id);
    const { strength, dexterity, constitution, intelligence, wisdom, charisma } = dnd.abilityScores;
    for (const score of [strength, dexterity, constitution, intelligence, wisdom, charisma]) assert.ok(Number.isInteger(score) && score > 0, `${character.id}: invalid ability score ${score}`);
    assert.ok(dnd.classes.length > 0);
    assert.ok(dnd.classes.every(entry => Number.isInteger(entry.level) && entry.level >= 1));
    assert.ok(dnd.hitPoints!.maximum > 0);
    assert.equal(dnd.hitPoints!.current, dnd.hitPoints!.maximum);
    assert.ok(character.inventory!.items.every(item => (item.quantity ?? 1) > 0));
  }
  const corvin = scenario.characters.find(character => character.id === "corvin")!;
  assert.equal(corvin.dnd!.classes[0]!.classId, "wizard");
  assert.ok(corvin.dnd!.spellcasting!.preparedSpellIds.includes("detect-magic"));

  const saved = physicalFixture(fromBinary(WorldStateSchema, toBinary(WorldStateSchema, scenario.source)));
  assert.deepEqual(saved.characters.map(character => character.dnd), scenario.characters.map(character => character.dnd));
});

test("inventory reads cannot mutate live owners or allocate missing inventories", () => {
  const scenario = example(), G = scenario.source.simulation!;
  const live = Object.values(G.runtimeCharacters);
  const owners = inventoryOwners(live, G.map);
  owners[0]!.inventory!.items.length = 0;
  inventoryFor(live, "guard").equipment!.attunedItemIds.length = 0;
  itemsFor(live, "guard")[0]!.name = "Changed";
  findItem(live, "sword")!.name = "Changed";
  locatedItems(live)[0]!.name = "Changed";
  assert.equal(G.runtimeCharacters.guard!.inventory!.items[0]!.name, "Sword");
  assert.deepEqual(G.runtimeCharacters.guard!.inventory!.equipment!.attunedItemIds, ["sword"]);
  inventoryFor(G.map!.rooms, "hall").items.push(itemsFor(live, "guard")[0]!);
  assert.equal(G.map!.rooms[0]!.inventory, undefined);
  const view = worldForCharacter(G.map!, inventoryOwners(live, G.map), "guard");
  view.fixtures[0]!.inventory!.items.length = 0;
  assert.equal(G.map!.fixtures[0]!.inventory!.items.length, 1);
});
