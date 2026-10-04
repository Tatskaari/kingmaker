import { renderPrompt } from "../../prompts/src/index.js";
import { JevClient, type JevChoice } from "./jev.js";

export const portraitExpressions = {
  amused: "The character visibly finds the exchange funny, playful, or entertaining.",
  angry: "The character shows irritation, indignation, frustration, or anger.",
  scared: "The character shows fear, alarm, apprehension, or intimidation.",
  serious: "The character is solemn, stern, focused, or grave without clear anger or fear.",
  neutral: "No other expression is clearly supported; the character is calm or matter-of-fact.",
} as const;
export type PortraitExpression = keyof typeof portraitExpressions;
export interface ConversationExpressionInput {
  characterId: string;
  history: readonly { speakerId: string; text: string }[];
  recentPortraits?: readonly PortraitExpression[];
}

/** Classify the portrait subject's visible expression, not the player's mood. */
export async function classifyConversationExpression(
  client: Pick<JevClient, "choose">, input: ConversationExpressionInput, signal: AbortSignal,
): Promise<{ expression: PortraitExpression; decision: JevChoice }> {
  signal.throwIfAborted();
  if (!input.characterId || !input.history.some(turn => turn.speakerId === input.characterId && turn.text.trim())) {
    throw new Error("A character reply is required for expression classification.");
  }
  const decision = await client.choose(input,
    renderPrompt("conversation-expression-1"),
    portraitExpressions, signal, "conversation expression classification");
  return { expression: decision.choice as PortraitExpression, decision };
}
