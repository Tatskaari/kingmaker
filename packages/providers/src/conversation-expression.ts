import { renderPrompt } from "../../prompts/src/index.js";
import { JevClient, type JevChoice } from "./jev.js";

export const portraitExpressions = {
  amused: renderPrompt("portrait-amused"),
  angry: renderPrompt("portrait-angry"),
  scared: renderPrompt("portrait-scared"),
  serious: renderPrompt("portrait-serious"),
  neutral: renderPrompt("portrait-neutral"),
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
    renderPrompt("portrait-instructions"),
    portraitExpressions, signal, "conversation expression classification");
  return { expression: decision.choice as PortraitExpression, decision };
}
