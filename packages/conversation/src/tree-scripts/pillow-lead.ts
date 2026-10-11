import { cartActions, type CartHookServices } from "./cart-actions.js";

/** Holt's spoken disclosure advances the investigation; it does not clear the cart. */
export async function pillowLead(services: CartHookServices, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const { quests } = services;
  await cartActions(services);
  let state = quests.read("assembly_programme");
  if (state.currentStageId !== "investigate_missing_pillows") return "The pillow lead is already recorded.";
  if (!state.active) state = await quests.setActive("assembly_programme", true, state.revision);
  await quests.transition("assembly_programme", "learn_cart_blocked", state.revision,
    "Holt explained that the pillow delivery is probably blocked by Rowan's cart.");
  return "Pillow lead recorded: investigate the blocked cart.";
}
