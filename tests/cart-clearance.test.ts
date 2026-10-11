import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { ItemInstanceSchema } from "../packages/contracts/src/index.js";
import { loadPlayableWorld } from "./fixtures.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { CART_BOOK_ID, CART_MEMORY, cartMemoryPath } from "../packages/lore/src/cart-clearance.js";
import { hasIntactCart } from "../packages/core/src/cart.js";

async function fixture() {
  const services = createScenarioServices(loadPlayableWorld());
  const quest = services.quests.read("assembly_programme");
  await services.quests.transition("assembly_programme", "learn_cart_blocked", quest.revision);
  return services;
}
for (const remedy of ["repair", "back_out"]) test(`${remedy} clears the cart and broadcasts one private memory to every character`, async () => {
  const services = await fixture();
  if (remedy === "repair") await services.inventory.addToInventory("player", create(ItemInstanceSchema, { id: CART_BOOK_ID, name: "Repair book" }));
  const before = services.currentWorld(), state = services.quests.read("assembly_programme");
  await services.quests.transition("assembly_programme", "clear_cart", state.revision, remedy);
  const world = services.currentWorld();
  assert.equal(hasIntactCart(world.simulation!.map!.fixtures), false);
  assert.equal(hasIntactCart(before.simulation!.map!.fixtures), true);
  assert.equal(services.quests.read("assembly_programme").currentStageId, "cart_unblocked");
  for (const actor of Object.values(world.simulation!.runtimeCharacters)) {
    const memory = world.docs[cartMemoryPath(actor.document)]!;
    assert.equal(memory.body, CART_MEMORY);
    assert.equal(memory.frontmatter!.visibility, "private");
  }
  await assert.rejects(services.quests.transition("assembly_programme", "clear_cart", state.revision, remedy));
  assert.equal(services.currentWorld(), world);
});
test("missing book or unestablished smash leaves progress, documents and fixtures untouched", async () => {
  for (const remedy of ["repair", "smash", "invented"]) {
    const services = await fixture(), before = services.currentWorld();
    await assert.rejects(services.quests.transition("assembly_programme", "clear_cart", services.quests.read("assembly_programme").revision, remedy));
    assert.equal(services.currentWorld(), before);
  }
});
