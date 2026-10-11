import { clone, create } from "@bufbuild/protobuf";
import { MapFixtureSchema } from "../../contracts/src/index.js";
import { DocumentSchema, type WorldState } from "../../contracts/src/v2.js";
import { memoryIndexPath } from "./memories.js";
import { hasIntactCart, isCartPart } from "../../core/src/cart.js";

export const CART_MEMORY = "The cart blocking the palace service entrance has been cleared. Deliveries can resume. The cushions have not yet been delivered.";
export const CART_BOOK_ID = "furn_corvin_cart_book";
export const cartMemoryPath = (entry: string) => memoryIndexPath(entry).replace("index.md", "cart-cleared.md");
export type CartRemedy = "repair" | "back_out" | "smash";

/** Stage just the affected fixtures and memory documents; the quest service publishes them together. */
export function prepareCartClearance(world: WorldState, remedy: string): WorldState {
  if (!["repair", "back_out", "smash"].includes(remedy)) throw new Error("A successful cart remedy is required.");
  const simulation = world.simulation!, map = simulation.map!;
  if (remedy === "repair" && !simulation.runtimeCharacters.player?.inventory?.items.some(item => item.id === CART_BOOK_ID)) {
    throw new Error("Bring Corvin's cart-repair book to Rowan first.");
  }
  const intact = hasIntactCart(map.fixtures);
  if (remedy === "smash" ? intact || !map.fixtures.some(f => f.id === "furn_gift_tree") : !intact) {
    throw new Error("The cart is not ready for that resolution.");
  }
  const docs = { ...world.docs };
  // Multiple bodies can share one character entry and memory index.
  for (const actor of Object.values(simulation.runtimeCharacters)) {
    const path = cartMemoryPath(actor.document), indexPath = memoryIndexPath(actor.document);
    if (docs[path]) continue;
    const index = docs[indexPath];
    if (!index) throw new Error(`Missing memory index: ${indexPath}`);
    docs[path] = create(DocumentSchema, { frontmatter: {
      visibility: "private", readers: index.frontmatter!.readers!, summary: CART_MEMORY,
      title: "The service entrance is clear", context: "Assembly Programme: cart cleared",
      cart_remedy: remedy, cart_review_pending: actor.characterId !== "player",
    }, body: CART_MEMORY });
    docs[indexPath] = { ...index, body: index.body.trimEnd() + "\n\n- [The service entrance is clear](cart-cleared.md) — The cart has been cleared; deliveries can resume.\n" };
  }
  if (!intact) return { ...world, docs };
  const tree = clone(MapFixtureSchema, map.fixtures.find(f => f.id === "furn_cart_right")!);
  tree.id = "furn_gift_tree";
  tree.name = remedy === "repair" ? "Potted gift tree beside the repaired cart" : "Potted gift tree after Rowan backed the cart out";
  tree.actions = [];
  return { ...world, docs, simulation: { ...simulation, map: { ...map,
    fixtures: [...map.fixtures.filter(f => !isCartPart(f)), tree], revision: map.revision + 1,
  } } };
}
