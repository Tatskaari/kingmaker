import { renderPrompt } from "../../prompts/src/index.js";
import { JevClient, type JevChoice, type JevChoiceQuestion } from "./jev.js";
import type { OpenRouterMessage } from "./openrouter.js";

const skills = {
  persuasion: renderPrompt("conversation-checks-1"),
  deception: renderPrompt("conversation-checks-2"),
  intimidation: renderPrompt("conversation-checks-3"),
  insight: renderPrompt("conversation-checks-4"),
  performance: renderPrompt("conversation-checks-5"),
  perception: renderPrompt("conversation-checks-6"),
  investigation: renderPrompt("conversation-checks-7"),
  sleight_of_hand: renderPrompt("conversation-checks-8"),
  stealth: renderPrompt("conversation-checks-9"),
  athletics: renderPrompt("conversation-checks-10"),
  acrobatics: renderPrompt("conversation-checks-11"),
  animal_handling: renderPrompt("conversation-checks-12"),
  arcana: renderPrompt("conversation-checks-13"),
  history: renderPrompt("conversation-checks-14"),
  nature: renderPrompt("conversation-checks-15"),
  religion: renderPrompt("conversation-checks-16"),
  medicine: renderPrompt("conversation-checks-17"),
  survival: renderPrompt("conversation-checks-18"),
} as const;

export type ConversationCheckSkill = keyof typeof skills;
export interface ConversationCheckInput {
  /** The current player's utterance or narrated action, kept separate from history. */
  playerTurn: string;
  /** Complete dialogue input, including character system prompts, supplied as evidence. */
  messages?: readonly OpenRouterMessage[];
  history?: readonly { speaker: string; text: string }[];
  /** Relevant established facts, obstacles, stakes, and the listener's disposition. */
  context?: string;
}
export interface ConversationCheckClassification {
  needsCheck: boolean;
  checks: ConversationCheckSkill[];
  /** Model evidence for debugging; probabilities are not dice-roll success odds. */
  decisions: Record<ConversationCheckSkill, JevChoice>;
}

const instructions = renderPrompt("conversation-checks-instructions");

export interface ConversationCheckResult {
  skill: ConversationCheckSkill;
  needsCheck: boolean;
  decision: JevChoice;
}
type CheckClassifier = (client: Pick<JevClient, "evaluate">, input: ConversationCheckInput, signal: AbortSignal) => Promise<ConversationCheckResult>;
const skillNames = Object.keys(skills) as ConversationCheckSkill[];
function questionFor(skill: ConversationCheckSkill): JevChoiceQuestion {
  return {
    type: "choice", instructions: renderPrompt("conversation-checks-20", { instructions: instructions, skill: skill, value3: skills[skill] }),
    criteria: {
      needed: renderPrompt("conversation-checks-21", { skill: skill }),
      not_needed: renderPrompt("conversation-checks-22", { skill: skill }),
    },
  };
}
function validateInput(input: ConversationCheckInput, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (!input.playerTurn.trim()) throw new Error("A player turn is required for check classification.");
}

/** Each callable classifier asks Jev about exactly one check type. */
export const conversationCheckClassifiers: Readonly<Record<ConversationCheckSkill, CheckClassifier>> = Object.freeze(
  Object.fromEntries(skillNames.map(skill => [skill, async (client: Pick<JevClient, "evaluate">, input: ConversationCheckInput, signal: AbortSignal) => {
    validateInput(input, signal);
    const answers = await client.evaluate(input, { [skill]: questionFor(skill) }, signal, renderPrompt("conversation-checks-23", { skill: skill }));
    const decision = answers[skill]!;
    return { skill, needsCheck: decision.choice === "needed", decision };
  }])) as Record<ConversationCheckSkill, CheckClassifier>,
);

/** One Decisions API request; does not mutate the conversation or resolve checks. */
export async function classifyConversationTurn(
  client: Pick<JevClient, "evaluate">, input: ConversationCheckInput, signal: AbortSignal,
): Promise<ConversationCheckClassification> {
  validateInput(input, signal);
  const questions = Object.fromEntries(skillNames.map(skill => [skill, questionFor(skill)]));
  const decisions = await client.evaluate(input, questions, signal, "conversation classification") as Record<ConversationCheckSkill, JevChoice>;
  const checks = skillNames.filter(skill => decisions[skill].choice === "needed");
  return { needsCheck: checks.length > 0, checks, decisions };
}
