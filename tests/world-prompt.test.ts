import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { ItemInstanceSchema } from "../packages/contracts/src/index.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { worldForCharacter,worldViewJson } from "../packages/core/src/physical-view.js";
import { renderWorldPrompt } from "../packages/core/src/world-prompt.js";
import { physicalFixture } from "./fixtures.js";

const load = physicalFixture;

test("narrative world context shrinks furnished worlds without losing knowledge or access constraints", () => {
  const scenario = load(), world = scenario.world!;
  const actor = world.actors.find(item => item.characterId === "abel")!;
  const local = world.fixtures.find(item => item.roomId === actor.roomId)!;
  const remote = world.fixtures.find(item => item.roomId !== actor.roomId && !item.container && !item.ownerCharacterId)!;
  remote.name = "REMOTE_FURNITURE_SENTINEL";
  const localRoom = world.rooms.find(room => room.id === actor.roomId)!;
  localRoom.allowedCharacterIds = ["abel"]; localRoom.private = true;
  scenario.characters.find(character => character.id === "abel")!.inventory.items.push(create(ItemInstanceSchema, { id: "private_letter", name: "Private letter", concealed: true }));
  const before = JSON.stringify(scenario);
  const view = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "abel");
  const prompt = renderWorldPrompt(scenario.characters, view, "abel");
  assert.ok(prompt.length < JSON.stringify(worldViewJson(view), null, 2).length / 3);
  assert.ok(prompt.includes(local.id));
  assert.ok(!prompt.includes(remote.name));
  assert.match(prompt, /"allowedCharacters":\["abel"\]/);
  assert.match(prompt, /"private":true/);
  assert.ok(prompt.includes("private_letter"), "retains the character's concealed inventory");
  assert.ok(!prompt.includes("palace_sealed_decree"), "does not reveal undiscovered contents");
  assert.ok(!prompt.includes('"sprite"') && !prompt.includes('"interactionSpot"'));
  assert.equal(JSON.stringify(scenario), before, "does not mutate authoritative state");
  remote.examinedBy.push("abel");
  assert.ok(renderWorldPrompt(scenario.characters, worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "abel"), "abel").includes(remote.name));
});
