import type { DndCharacter } from "../../contracts/src/index.js";
import { classifyConversationTurn, type ConversationCheckClassification } from "../../providers/src/conversation-checks.js";
import type { ConversationHooks } from "./phases.js";
import type { ConversationRuntime } from "./runtime.js";
import { adjudicateConversationChecks } from "./checks.js";

export interface CheckLabels { checks: ConversationCheckClassification }

/** Existing check policy behind the same classify/resolve contract as disclosure. */
export function checkHooks(runtime: ConversationRuntime<CheckLabels>, options: {
  playerTurn: string;
  playerId: string;
  build: DndCharacter | undefined;
  context?: unknown;
}): ConversationHooks<CheckLabels> {
  return {
    classify: async (context, signal) => ({ checks: await classifyConversationTurn(
      { evaluate: (state, questions, cancellation) => runtime.services.ai.decisions(state, questions, cancellation) },
      { playerTurn: options.playerTurn, messages: context.request.messages }, signal,
    ) }),
    resolve: async (context, labels, signal) => {
      if (context.completed.has("checks")) return { reclassify: false };
      const ruling = await adjudicateConversationChecks({ skills: labels.checks.checks,
        messages: context.request.messages, context: options.context, build: options.build,
        complete: request => runtime.services.ai.responses(request, signal),
        present: result => runtime.services.presentation.showRoll({ characterId: options.playerId,
          skill: result.skill, natural: result.roll, modifier: result.modifier, total: result.total,
          difficulty: { dc: result.dc }, dc: result.dc, success: result.success, outcome: result.degree }, signal),
        signal,
      });
      if (ruling) context.request.messages.push({ role: "system", content: ruling });
      context.completed.add("checks");
      return { reclassify: false };
    },
  };
}
