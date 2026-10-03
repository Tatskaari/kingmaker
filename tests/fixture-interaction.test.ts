import assert from "node:assert/strict";
import test from "node:test";
import { fixtureActions } from "../packages/core/src/fixtures.js";
import { generationIds } from "../packages/core/src/generations.js";
import { requireCurrentFixtureAction } from "../apps/web/src/court-interactions.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { projectWorld } from "../apps/web/src/world-projection.js";
import { loadPlayableWorld } from "./fixtures.js";

function furnishedWorld() {
  const world = loadPlayableWorld();
  const fixture = world.map!.fixtures.find(item => item.id === "palace_corvin_drawers")!;
  fixture.open = true;
  world.map!.actors.find(actor => actor.characterId === "player")!.position = fixture.interactionSpot;
  return world;
}

test("queued furniture choices reject removed actions and items moved to the player", () => {
  const scenario = projectWorld(furnishedWorld());
  const choices = fixtureActions(scenario, "player");
  const take = choices.find(action => action.id === "take_palace_royal_key")!;
  const inspect = choices.find(action => action.id === "inspect_item_palace_royal_key")!;
  requireCurrentFixtureAction(take, choices);
  // A refreshed menu can retain an item's inspect ID with a different location.
  assert.throws(() => requireCurrentFixtureAction(inspect, [{ ...inspect, target: "player" }]), /no longer available/);
  scenario.world!.fixtures.find(item => item.id === take.target)!.open = false;
  const refreshed = fixtureActions(scenario, "player");
  assert.throws(() => requireCurrentFixtureAction(take, refreshed), /no longer available/);
  assert.throws(() => requireCurrentFixtureAction(inspect, refreshed), /no longer available/);
  const furniture = choices.find(action => action.id === "inspect_palace_corvin_drawers")!;
  requireCurrentFixtureAction(furniture, refreshed);
});

test("repeating a completed furniture action reports an unavailable choice without mutating the world", async () => {
  const runtime = new WorldGameRuntime(furnishedWorld(), "");
  const take = { kind: "fixture" as const, id: "take_palace_royal_key" };
  const result = await runtime.executeAction({ command: take });
  assert.match(result.message!, /Picked up/);
  const before = runtime.world();
  // Walking refreshes generation IDs, but does not make the old menu choice valid.
  const expected = generationIds(runtime.readResources());
  await assert.rejects(runtime.executeAction({ command: take, expected }), /no longer available/);
  assert.deepEqual(runtime.world(), before);
  const inspect = await runtime.executeAction({ command: { kind: "fixture", id: "inspect_item_palace_royal_key" } });
  assert.match(inspect.message!, /Royal lockbox key/);
});
