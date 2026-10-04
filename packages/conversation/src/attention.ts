import { renderPrompt } from "../../prompts/src/index.js";
import type { JevChoice, JevQuestions } from "../../providers/src/jev.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { AiService, RollResult } from "./services.js";

export type AnalysisEvent =
  | { kind: "labels"; subject: "player" | "character"; source: string; decisions: Record<string, JevChoice> }
  | { kind: "roll"; subject: "player"; result: Readonly<RollResult> }
  | { kind: "error"; subject: "character"; error: string };

const guidance = renderPrompt("attention-guidance");
const categories = {
  immediate_commitment: renderPrompt("attention-immediate-commitment"),
  deferred_commitment: renderPrompt("attention-deferred-commitment"),
  general_commitment: renderPrompt("attention-general-commitment"),
  improvised_detail: renderPrompt("attention-improvised-detail"),
  plot_progress: renderPrompt("attention-plot-progress"),
  other_world_update: renderPrompt("attention-other-world-update"),
  conversational_exchange: renderPrompt("attention-conversational-exchange"),
  relationship_or_knowledge_change: renderPrompt("attention-relationship-or-knowledge-change"),
};
export const attentionQuestions: JevQuestions = {
  ...Object.fromEntries(Object.entries(categories).map(([name, criterion]) => [name, {
    type: "choice" as const, instructions: renderPrompt("attention-instructions", { guidance, name, criterion }),
    criteria: { flagged: renderPrompt("attention-flagged", { name }), not_flagged: renderPrompt("attention-not-flagged", { name }) },
  }])),
  immediate_feasibility: { type: "choice", instructions: renderPrompt("attention-feasibility", { guidance }), criteria: {
    possible: renderPrompt("attention-possible"),
    gms_discretion: renderPrompt("attention-gms-discretion"),
    impossible: renderPrompt("attention-impossible"),
    unknown: renderPrompt("attention-unknown"),
    not_applicable: renderPrompt("attention-not-applicable"),
  } },
};

export async function analyzeAttention(ai: AiService, messages: readonly OpenRouterMessage[], characterReply: OpenRouterMessage,
  signal: AbortSignal): Promise<Record<string, JevChoice>> {
  signal.throwIfAborted();
  const answers = await ai.decisions({ messages, characterReply }, attentionQuestions, signal, "conversation_attention");
  signal.throwIfAborted();
  return answers;
}
