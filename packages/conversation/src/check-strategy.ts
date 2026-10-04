import { renderPrompt } from "../../prompts/src/index.js";
import { runGameMaster } from "./game-master.js";
import { classifyConversationTurn, type ConversationCheckClassification } from "../../providers/src/conversation-checks.js";
import type { ConversationContext } from "./phases.js";
import type { ConversationRuntime } from "./runtime.js";
import { adjudicateResolvedChecks, type CheckPlan } from "./checks.js";

export interface CheckLabels { checks: ConversationCheckClassification; plan?: CheckPlan[] }

/** Existing check policy behind the same classify/resolve contract as disclosure. */
export function checkStrategy(runtime: ConversationRuntime, options: {
  playerTurn: string;
  playerId: string;
  context?: unknown;
  characterId?: string;
}) {
  return {
    classify: async (context: Readonly<ConversationContext>, signal: AbortSignal): Promise<CheckLabels> => {
      const state = { playerTurn: options.playerTurn, messages: context.request.messages, context: options.context };
      const checks = await classifyConversationTurn(
        { evaluate: (input, questions, cancellation) => runtime.services.ai.decisions(input, questions, cancellation, "skill_check") }, { playerTurn: options.playerTurn, messages: context.request.messages }, signal);
      if (!checks.checks.length) return { checks, plan: [] };
      const criteria = {
        trivial: renderPrompt("difficulty-trivial"), very_easy: renderPrompt("difficulty-very_easy"), easy: renderPrompt("difficulty-easy"), normal: renderPrompt("difficulty-normal"),
        hard: renderPrompt("difficulty-hard"), very_hard: renderPrompt("difficulty-very_hard"), impossible: renderPrompt("difficulty-impossible"),
      };
      const decisions = await runtime.services.ai.decisions(state, Object.fromEntries(checks.checks.map(skill => [skill, {
        type: "choice" as const,
        instructions: renderPrompt("check-difficulty", { skill: skill }),
        criteria,
      }])), signal, "skill_difficulty");
      const plan = checks.checks.map(skill => {
        const difficulty = decisions[skill]?.choice;
        if (!difficulty || !Object.hasOwn(criteria, difficulty)) throw new Error(`Invalid Jev difficulty for ${skill}`);
        return { skill, difficulty: difficulty as CheckPlan["difficulty"] };
      });
      return { checks, plan };
    },
    resolve: async (context: ConversationContext, labels: Readonly<CheckLabels>, signal: AbortSignal) => {
      if (context.completed.has("checks")) return { reclassify: false };
      if (!labels.plan && labels.checks.checks.length) throw new Error("Missing classified check plan");
      const results = [];
      for (const check of labels.plan ?? []) {
        signal.throwIfAborted();
        results.push(Object.freeze(await runtime.services.character.rollCheck({ characterId: options.playerId, ...check }, signal)));
        signal.throwIfAborted();
      }
      const ruling = await adjudicateResolvedChecks({ results, messages: context.request.messages,
        complete: (request, cancellation) => runGameMaster(request, runtime.services, cancellation, options.characterId ? { characterId: options.characterId } : {}),
        present: (result, cancellation) => runtime.services.presentation.showRoll(result, cancellation),
        signal,
      });
      if (ruling) context.request.messages.push({ role: "system", content: ruling });
      context.completed.add("checks");
      return { reclassify: false };
    },
  };
}
