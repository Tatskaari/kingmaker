import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import type { ReviewVariant } from "./review-experiment.js";

/** Experimental policies, not claims that either improves on the game baseline. */
export const reviewVariants: readonly ReviewVariant[] = [
  { name: "evidence-first", strategies: { review: {
    async classify(context, signal, services) {
      const questions = Object.fromEntries([
        ["commitment", "Does the conversation establish a commitment that requires future action?"],
        ["knowledge", "Does the conversation establish new knowledge or beliefs worth remembering?"],
        ["quest", "Does the conversation contain evidence of quest progress?"],
      ].map(([name, instructions]) => [name!, { type: "choice" as const, instructions: instructions!,
        criteria: { present: "The transcript provides evidence for this.", absent: "The transcript does not provide evidence for this." } }]));
      return services.ai.decisions(context, questions, signal);
    },
  } } },
  { name: "minimal-edits", strategies: { setup: {
    async prepare(context, signal, services) {
      const messages = await defaultWorldStrategies.setup.prepare(context, signal, services);
      if (context.agent === "game_master") messages.splice(1, 0, { role: "system", content:
        "Make the smallest sufficient set of document edits. Preserve existing wording and characterization where possible. Record consequential new memories without duplication. Change intent only when the evidence warrants it, and distinguish commitments from completed physical actions." });
      return messages;
    },
  } } },
];
