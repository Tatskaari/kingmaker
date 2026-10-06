import assert from "node:assert/strict";
import test from "node:test";
import { create, toJson } from "@bufbuild/protobuf";
import { ActorStateSchema } from "../packages/contracts/src/index.js";
import { CharacterPropertiesSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";

function fixture() {
  const world = loadPlayableWorld();
  delete world.docs[world.player!]; delete world.player; delete world.simulation!.runtimeCharacters.player;
  return createScenarioServices(world);
}
const text = '---\nname: Alex\nsummary: Alex’s private identity.\nvisibility: private\nreaders: ["character:player"]\n---\nYou serve the Stranger.';
const player = { id: "player", path: "Players/player.md", text, properties: create(CharacterPropertiesSchema) };
test("character creation and player designation are separate from knowledge and introduction state", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const runtime = new ConversationRuntime({ services });
  await runtime.character.create(player);
  const created = services.scenario.snapshot();
  assert.equal(created.player, undefined);
  assert.deepEqual(created.simulation!.map!.actors, before.simulation!.map!.actors);
  assert.equal(created.simulation!.map!.phase, before.simulation!.map!.phase);
  assert.equal(created.simulation!.map!.day, before.simulation!.map!.day);
  for (const path of before.characters) assert.deepEqual(created.docs[path], before.docs[path]);
  await runtime.services.scenario.setPlayer(player.path);
  assert.equal(services.scenario.info().player, player.path);
  await assert.rejects(runtime.character.create(player), /already exists/);
});
test("NPC creation adds a scenario link and actor without notifying other characters", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const path = "Scenarios/Centennial Assembly/Characters/visitor/character.md";
  const actor = create(ActorStateSchema, { ...before.simulation!.map!.actors[0]!, characterId: "visitor" });
  await services.character.create({ id: "visitor", path, text: "A visiting scholar.", properties: create(CharacterPropertiesSchema), actor });
  const after = services.scenario.snapshot();
  assert.ok(after.characters.includes(path));
  assert.equal(after.simulation!.map!.actors.filter(item => item.characterId === "visitor").length, 1);
  assert.equal(after.player, undefined);
  for (const entry of before.characters) assert.deepEqual(after.docs[entry], before.docs[entry]);
  const restored = createScenarioServices(after);
  assert.ok(restored.scenario.info().characters.includes(path));
});
test("invalid character creation publishes no documents, actor or scenario links", async () => {
  const services = fixture(), before = toJson(WorldStateSchema, services.scenario.snapshot());
  await assert.rejects(services.character.create({ ...player, text: text + "\n[[missing]]" }), /Missing|resolve|not found/i);
  await assert.rejects(services.character.create({ ...player, id: "visitor" }), /scenario character path/);
  await assert.rejects(services.scenario.setPlayer("missing.md"), /created player/);
  assert.deepEqual(toJson(WorldStateSchema, services.scenario.snapshot()), before);
});

test("character creation validates private links before publishing documents or actors", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const secret = Object.keys(before.docs).find(path => path.endsWith("/gm.md"))!;
  const unsafe = `${text}\n[[${secret}]]`;
  await assert.rejects(services.character.create({ ...player, text: unsafe }), /denied/);
  const path = "Scenarios/Centennial Assembly/Characters/visitor/character.md";
  const actor = create(ActorStateSchema, { ...before.simulation!.map!.actors[0]!, characterId: "visitor" });
  await assert.rejects(services.character.create({ id: "visitor", path, text: `[[${secret}]]`,
    properties: create(CharacterPropertiesSchema), actor }), /denied/);
  assert.deepEqual(services.scenario.snapshot(), before);
});
