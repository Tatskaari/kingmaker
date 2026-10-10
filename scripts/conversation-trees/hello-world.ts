import type { QuestService } from "../../packages/lore/src/quest-service.js";

/** Runs in the host after the player agrees; never in the character model. */
export async function helloWorld(quests: QuestService, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const quest = quests.read("assembly_programme");
  await quests.setActive("assembly_programme", true, quest.revision);
  return "Hello world! Assembly Programme is now active.";
}
