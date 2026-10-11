export default async function run(services: HookServices): Promise<TransitionResult> {
  const fixtures = services.map.listFixtures();
  const remedy = services.transition?.evidence || (fixtures.some(f => f.id === "furn_gift_tree") ? "smash" : "");
  if (!["repair", "back_out", "smash"].includes(remedy || "")) return { status: "rejected", message: "A successful cart remedy is required." };
  if (remedy === "repair" && !services.inventory.hasItem("player", "furn_corvin_cart_book")) {
    return { status: "rejected", message: "Bring Corvin's cart-repair book to Rowan first." };
  }
  if (remedy === "smash" && !fixtures.some(f => f.id === "furn_gift_tree")) {
    return { status: "rejected", message: "The cart has not been successfully smashed." };
  }
  if (fixtures.some(f => f.id === "furn_cart_right")) await services.map.updateFixture("furn_cart_right", fixture => {
    fixture.name = "Potted gift tree beside the cleared entrance";
    fixture.actions = [];
  });
  await services.map.removeFixtures(["furn_cart_left"]);
  await services.memories.broadcast("cart-cleared", {
    title: "The service entrance is clear",
    context: "Assembly Programme: the cart obstruction has been resolved.",
    content: "The cart blocking the palace service entrance has been cleared. Deliveries can resume. The cushions have not yet been delivered.",
    review: "The cart was cleared by " + remedy + ". Everyone has already received the fixed public clearance memory. Update this character's current dialogue-tree node and future branches to acknowledge clearance and stop pursuing the blocked-cart problem. Preserve unrelated dialogue, existing node IDs and private knowledge boundaries. Repair: Rowan and Nine Furrows appreciate the player's help. Backing out: Rowan is slightly resentful, Nine Furrows neutral. Smashing: Nine Furrows is unhappy even if Holt authorised it. Holt appreciates resolution. Aldren still awaits actual cushion delivery. Other characters may acknowledge the public clearance when relevant. Do not invent delivery, create duplicate memories, replay clearance, or disclose private negotiations. Characters without a dialogue tree need no new tree unless their existing goals require one.",
  });
  return { status: "accepted", message: "The cart is cleared. Deliveries can resume; the cushions have not yet arrived." };
}
