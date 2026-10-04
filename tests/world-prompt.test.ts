import { inventoryOwners } from "../packages/core/src/inventory.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromJsonString, toJson } from "@bufbuild/protobuf";
import { DialogueRequestSchema, GameMasterRequestSchema, ScenarioSchema } from "../packages/contracts/src/index.js";
import { worldForCharacter, worldViewJson } from "../packages/core/src/physical-view.js";
import { renderWorldPrompt } from "../packages/core/src/world-prompt.js";

const load = () => fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));

test("narrative world context shrinks furnished worlds without losing knowledge or access constraints", () => {
  const scenario = load(), world = scenario.world!;
  const actor = world.actors.find(item => item.characterId === "rook")!;
  const local = world.fixtures.find(item => item.roomId === actor.roomId)!;
  const remote = world.fixtures.find(item => item.roomId !== actor.roomId && !item.container && !item.ownerCharacterId)!;
  remote.name = "REMOTE_FURNITURE_SENTINEL";
  const localRoom = world.rooms.find(room => room.id === actor.roomId)!;
  localRoom.allowedCharacterIds = ["rook"]; localRoom.private = true;
  const before = JSON.stringify(toJson(ScenarioSchema, scenario));
  const view = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "rook");
  const prompt = renderWorldPrompt(scenario.characters, view, "rook");
  assert.ok(prompt.length < JSON.stringify(worldViewJson(view), null, 2).length / 3);
  assert.ok(prompt.includes(local.id));
  assert.ok(!prompt.includes(remote.name));
  assert.match(prompt, /"allowedCharacters":\["rook"\]/);
  assert.match(prompt, /"private":true/);
  assert.ok(prompt.includes("rook_tomas_letter"), "retains the character's concealed inventory");
  assert.ok(!prompt.includes("palace_sealed_decree"), "does not reveal undiscovered contents");
  assert.ok(!prompt.includes('"sprite"') && !prompt.includes('"interactionSpot"'));
  assert.equal(JSON.stringify(toJson(ScenarioSchema, scenario)), before, "does not mutate authoritative state");
  remote.examinedBy.push("rook");
  assert.ok(renderWorldPrompt(scenario.characters, worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "rook"), "rook").includes(remote.name));
});
