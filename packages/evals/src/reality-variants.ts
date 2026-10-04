import { createInventoryReviewServices } from "./inventory-docs-candidate.js";
import { GAME_MASTER_PROMPT } from "../../conversation/src/agent-setup.js";
import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import type { ReviewVariant } from "./review-experiment.js";

const priorities = `You are the game master of an ongoing scene, not a scheduler for every sentence. Keep characters' present circumstances and priorities in view. Remember meaningful agreements without making each one their current task. An undated ambition can remain a warm intention for a later occasion; successful persuasion establishes willingness, not necessarily an immediate departure. Choose a new activity when the exchange gives the character a concrete reason and opportunity to act now. Otherwise preserve their current intent. Keep character memories in their own perspective: what they heard, believed, promised or experienced, without rules adjudication or repeating existing notes.`;

export function realityVariant(name: string, situated: boolean): ReviewVariant {
  return { name, strategies: { setup: { async prepare(context, signal, services) {
    const messages = await defaultWorldStrategies.setup.prepare(context, signal, services);
    if (context.agent !== "game_master") return messages;
    const prompt = GAME_MASTER_PROMPT.replace(/^2\. .*$/m, `2. ${priorities}`)
      .replace("Set an executable activity while work remains;", "Set an executable activity when immediate work is justified;");
    const result = messages.map(message => message.role === "system" && message.content === GAME_MASTER_PROMPT
      ? { ...message, content: prompt } : message);
    if (situated) {
      const world = services.scenario.snapshot();
      result.push({ role: "user", content: JSON.stringify({ sceneCapabilities: {
        scenario: world.scenario, playerDocument: world.player,
        playablePlaces: world.map?.rooms.map(({ id, name }) => ({ id, name })),
        note: "These are the locations available for current play, not a complete account of the fictional world. Future undertakings outside this scene can be remembered without displacing current life. Do not invent travel preparations merely to create a task.",
      } }) });
    }
    return result;
  } } } };
}

export const realityVariants = [realityVariant("present-priorities", false), realityVariant("situated-priorities", true)];

/** Hold framing fixed against situated-priorities to isolate writable possessions. */
export const materialConsequencesVariant: ReviewVariant = {
  ...realityVariant("material-consequences", true),
  createServices: createInventoryReviewServices,
  strategies: { setup: { async prepare(context, signal, services) {
    const messages = await realityVariant("material-consequences", true).strategies!.setup!.prepare!(context, signal, services);
    if (context.agent !== "game_master") return messages;
    messages.push({ role: "system", content: "Character document reads expose a writable inventory YAML property backed by actual possessions. Use the existing read/replace document tools to update it; memory prose alone does not change possession. Existing items keep their IDs and equipment references must remain valid. A harmless object introduced in an agreed exchange may be established with a new unique ID, name, details and quantity. When someone asks for an ordinary gift and its owner willingly gives it, resolve the exchange rather than demanding an extra acceptance turn. Preserve unrelated possessions and characterization. Do not turn reported travel stories into verified world history." });
    return messages;
  } } },
};
