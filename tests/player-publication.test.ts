import assert from "node:assert/strict";
import test from "node:test";
import { create, toJson } from "@bufbuild/protobuf";
import { CharacterPropertiesSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { GamePhase } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

function fixture() {
  const world = loadPlayableWorld();
  delete world.docs[world.player!]; delete world.player;
  world.map!.phase = GamePhase.PLAYER_CREATION;
  return createScenarioServices(world);
}
const text = '---\nname: Alex\nsummary: Alex’s private identity.\nvisibility: private\nreaders: ["character:player"]\n---\nYou serve the Stranger.';
function publication(services: ReturnType<typeof fixture>) {
  return { path: "Players/player.md", text, properties: create(CharacterPropertiesSchema),
    impressions: Object.fromEntries(services.scenario.info().characters.map(path => [path, "A visiting scholar."])) };
}
test("player publication atomically installs v2 documents and preserves authored positions and NPC metadata", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const input = publication(services);
  await services.playerCreation.publish(input);
  const after = services.scenario.snapshot();
  assert.equal(after.player, input.path);
  assert.equal(after.map!.phase, GamePhase.CONVERSATIONS);
  assert.deepEqual(after.map!.actors, before.map!.actors);
  assert.match(after.docs[input.path]!.body, /Stranger/);
  for (const path of after.characters) {
    assert.deepEqual(after.docs[path]!.frontmatter, before.docs[path]!.frontmatter);
    assert.deepEqual(after.docs[path]!.links, before.docs[path]!.links);
    assert.doesNotMatch(after.docs[path]!.body, /serve the Stranger/);
  }
  await assert.rejects(services.playerCreation.publish(input), /already exists/);
});
test("invalid player publication changes neither the world nor any NPC", async () => {
  const services = fixture(), before = toJson(WorldStateSchema, services.scenario.snapshot());
  const input = publication(services);
  input.impressions[services.scenario.info().characters.at(-1)!] = "[[Players/player.md]]";
  await assert.rejects(services.playerCreation.publish(input), /document links/);
  input.impressions[services.scenario.info().characters.at(-1)!] = "";
  await assert.rejects(services.playerCreation.publish(input), /impression/);
  assert.deepEqual(toJson(WorldStateSchema, services.scenario.snapshot()), before);
  await assert.rejects(services.playerCreation.publish({ ...publication(services), text: text + "\n[[missing]]" }), /Missing|resolve|not found/i);
  assert.deepEqual(toJson(WorldStateSchema, services.scenario.snapshot()), before);
});
