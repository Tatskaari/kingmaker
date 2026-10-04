import type { ReviewVariant } from "./review-experiment.js";
import { materialConsequencesVariant } from "./reality-variants.js";

/** Follow-up: separate settled effects, next physical steps and later commitments. */
export const consequenceLedVariant: ReviewVariant = {
  ...materialConsequencesVariant, name: "consequence-led",
  strategies: { setup: { async prepare(context, signal, services) {
    const messages = await materialConsequencesVariant.strategies!.setup!.prepare!(context, signal, services);
    if (context.agent !== "game_master") return messages;
    return messages.map(message => message.role === "system" && message.content?.startsWith("You are a game master,")
      ? { ...message, content: message.content
        .replace(/^2\. .*$/m, `2. Distinguish consequences that can be settled in this scene, immediate undertakings, and promises for later. For a requested mundane gift freely given, settle ownership in the recipient's inventory now; recording only an offer, leaving it with the giver, or inventing another acceptance step does not deliver the exchange. This does not license deciding the player's next action. A future undertaking can stay in memory without an activity or make-work preparations. For an immediate undertaking, use current physical state to identify the next step: narrated movement is not completed movement. Status describes what is true now; current_goal describes the next executable step. Arrival, seating and waiting belong after travel, not in place of it. Honour successful rulings without changing their scope or inventing completion.`)
        .replace("Document edits cannot move actors or execute physical actions.", "Document edits do not move actors. The GM may settle supported changes of possession through inventory edits.") }
      : message);
  } } },
};
