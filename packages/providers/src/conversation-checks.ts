import { renderPrompt } from "../../prompts/src/index.js";
import { JevClient, type JevChoice, type JevChoiceQuestion } from "./jev.js";
import type { OpenRouterMessage } from "./openrouter.js";

const skills = {
  persuasion: renderPrompt("conversation-checks-persuasion"),
  deception: renderPrompt("conversation-checks-deception"),
  intimidation: renderPrompt("conversation-checks-intimidation"),
  insight: renderPrompt("conversation-checks-insight"),
  performance: renderPrompt("conversation-checks-performance"),
  perception: renderPrompt("conversation-checks-perception"),
  investigation: renderPrompt("conversation-checks-investigation"),
  sleight_of_hand: renderPrompt("conversation-checks-sleight-of-hand"),
  stealth: renderPrompt("conversation-checks-stealth"),
  athletics: renderPrompt("conversation-checks-athletics"),
  acrobatics: renderPrompt("conversation-checks-acrobatics"),
  animal_handling: renderPrompt("conversation-checks-animal-handling"),
  arcana: renderPrompt("conversation-checks-arcana"),
  history: renderPrompt("conversation-checks-history"),
  nature: renderPrompt("conversation-checks-nature"),
  religion: renderPrompt("conversation-checks-religion"),
  medicine: renderPrompt("conversation-checks-medicine"),
  survival: renderPrompt("conversation-checks-survival"),
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
    type: "choice", instructions: renderPrompt("conversation-checks-skill", { instructions: instructions, skill: skill, guidance: skills[skill] }),
    criteria: {
      needed: renderPrompt("conversation-checks-needed", { skill: skill }),
      not_needed: renderPrompt("conversation-checks-not-needed", { skill: skill }),
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
    const answers = await client.evaluate(input, { [skill]: questionFor(skill) }, signal, renderPrompt("conversation-checks-operation", { skill: skill }));
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
