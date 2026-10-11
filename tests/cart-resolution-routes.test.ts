import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld } from "./fixtures.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { hasIntactCart } from "../packages/core/src/cart.js";

for (const remedy of ["repair", "back-out"]) test(`${remedy} hook clears directly and cannot duplicate memories`, async () => {
  const services = createScenarioServices(loadPlayableWorld()), signal = new AbortController().signal;
  if (remedy === "repair") {
    assert.equal((await services.hooks.bind()["repair-cart.ts"]!(signal)).status, "rejected");
    await services.inventory.transferBetweenInventories("furn_corvin_reference", "player", "furn_corvin_cart_book");
  }
  const hook = services.hooks.bind()[`${remedy}-cart.ts`]!;
  assert.equal((await hook(signal)).status, "accepted");
  const count = Object.keys(services.currentWorld().docs).length;
  assert.equal((await hook(signal)).status, "accepted");
  assert.equal(Object.keys(services.currentWorld().docs).length, count);
  assert.equal(services.quests.read("assembly_programme").currentStageId, "cart_unblocked");
  assert.equal(hasIntactCart(services.currentWorld().simulation!.map!.fixtures), false);
  assert.ok(services.currentWorld().docs["Reviews/cart-cleared.md"]);
});
for (const natural of [1, 20]) test(`physical smash rolls ${natural} and invokes its authored success hook only on success`, async () => {
  const world = loadPlayableWorld(), target = world.simulation!.map!.fixtures.find(f => f.id === "furn_cart_left")!;
  world.simulation!.map!.actors.find(a => a.characterId === "player")!.position = { ...target.interactionSpot! };
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: { random: { integer: () => natural } } });
  await game.services.hooks.bind()["hello-world.ts"]!(new AbortController().signal);
  const result = await game.executeAction({ command: { kind: "fixture", id: "smash_furn_cart_left" } });
  assert.equal(result.roll?.success, natural === 20);
  assert.equal(game.services.quests.read("assembly_programme").currentStageId, natural === 20 ? "cart_unblocked" : "investigate_missing_pillows");
  assert.equal(!!game.world().docs["Reviews/cart-cleared.md"], natural === 20);
  game.restore(game.snapshot());
  assert.equal(!!game.world().docs["Reviews/cart-cleared.md"], natural === 20);
});
