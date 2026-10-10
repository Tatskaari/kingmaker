import { QuestTrigger, type QuestState } from "../../contracts/src/v2.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { renderPrompt } from "../../prompts/src/index.js";
import type { AiService } from "./services.js";

/** Read-only nominations. Neither a positive decision nor its probability establishes quest progress. */
export async function classifyQuestTransitions(states: readonly QuestState[], characterId: string,
  messages: readonly OpenRouterMessage[], ai: Pick<AiService, "decisions">, signal: AbortSignal) {
  signal.throwIfAborted();
  const candidates = states.flatMap(state => (state.quest?.transitions ?? [])
    .filter(edge => edge.fromStageId === state.currentStageId && edge.trigger === QuestTrigger.DISCRETIONARY)
    .map(edge => ({ questId: state.quest!.id, questTitle: state.quest!.title, stageId: state.currentStageId,
      expectedRevision: state.revision, transitionId: edge.id, description: edge.description, condition: edge.condition })));
  if (!candidates.length) return [];
  const questions = Object.fromEntries(candidates.map((candidate, index) => [`transition_${index}`, {
    type: "choice" as const,
    instructions: renderPrompt("quest-classification", { candidate: JSON.stringify(candidate) }),
    criteria: { condition_met: renderPrompt("quest-condition-met"), condition_not_met: renderPrompt("quest-condition-not-met") },
  }]));
  const decisions = await ai.decisions({ characterId, messages, candidates }, questions, signal, "quest_transition", { characterId });
  signal.throwIfAborted();
  return candidates.map((candidate, index) => ({ ...candidate, decision: decisions[`transition_${index}`]! }));
}
