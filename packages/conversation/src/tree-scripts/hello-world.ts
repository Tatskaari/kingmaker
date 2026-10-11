import { cartActions, type CartHookServices } from "./cart-actions.js";

/** Runs in the host after the player agrees; never in the character model. */
export async function helloWorld(services: CartHookServices, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const { quests } = services;
  await cartActions(services);
  const quest = quests.read("assembly_programme");
  await quests.setActive("assembly_programme", true, quest.revision);
  return "Hello world! Assembly Programme is now active.";
}
