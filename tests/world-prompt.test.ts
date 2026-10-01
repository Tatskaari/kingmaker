import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromJsonString, toJson } from "@bufbuild/protobuf";
import { DialogueRequestSchema, GameMasterRequestSchema, ScenarioSchema } from "../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter, worldViewJson } from "../packages/core/src/context.js";
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
  const view = worldForCharacter(scenario, "rook");
  const prompt = renderWorldPrompt(scenario, view, "rook");
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
  assert.ok(renderWorldPrompt(scenario, worldForCharacter(scenario, "rook"), "rook").includes(remote.name));
});

test("dialogue and GM builders use compact views with separate knowledge boundaries", () => {
  const scenario = load();
  const dialogue = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: "rook" }));
  const gm = new FullGameMasterContextBuilder().build(create(GameMasterRequestSchema, { scenario }));
  const known = dialogue.find(message => message.content.startsWith("# Known world state"))!.content;
  const complete = gm.find(message => message.content.startsWith("# Complete world state"))!.content;
  assert.match(known, /Room connections describe the map/);
  assert.ok(!known.includes("palace_sealed_decree"));
  assert.ok(complete.includes("palace_sealed_decree"));
  for (const fixture of scenario.world!.fixtures) assert.ok(complete.includes(fixture.id));
  for (const room of scenario.world!.rooms) assert.ok(known.includes(room.id));
});
