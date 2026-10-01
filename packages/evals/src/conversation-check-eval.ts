import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateTranscript } from "./unit-eval.js";
import { conversationCheckClassifiers } from "../../providers/src/conversation-checks.js";
import type { ConversationCheckInput, ConversationCheckSkill } from "../../providers/src/conversation-checks.js";

export interface ConversationCheckEvalCase {
  name: string;
  input: ConversationCheckInput;
  expected?: ConversationCheckSkill[];
}

/** Reuse dialogue eval character fixtures and the scenario-backed context builder. */
export function loadConversationCheckEval(file: string): ConversationCheckEvalCase {
  const path = resolve(file);
  const source = JSON.parse(readFileSync(path, "utf8"));
  if (!source || typeof source.name !== "string" || !source.name.trim()) throw new Error("Eval name is required.");
  if (!Array.isArray(source.transcript) || source.transcript[0]?.type !== "character_conversation_sys_prompt") {
    throw new Error("Start the transcript with a scenario-backed character fixture.");
  }
  if (source.transcript.at(-1)?.type !== "user_message") throw new Error("End the transcript with the current player turn.");
  if (source.expected !== undefined && (!Array.isArray(source.expected)
    || source.expected.some((skill: unknown) => typeof skill !== "string" || !Object.hasOwn(conversationCheckClassifiers, skill))
    || new Set(source.expected).size !== source.expected.length)) throw new Error("expected must contain unique supported skills.");
  const { messages } = validateTranscript(source, path);
  return { name: source.name, input: { playerTurn: messages.at(-1)!.content!, messages },
    ...(source.expected === undefined ? {} : { expected: source.expected }) };
}

/** Human-authored labels are the oracle; Jev is the subject, not its own judge. */
export function scoreConversationChecks(expected: readonly ConversationCheckSkill[], actual: readonly ConversationCheckSkill[]) {
  const missed = [...new Set(expected)].filter(skill => !actual.includes(skill));
  const extra = [...new Set(actual)].filter(skill => !expected.includes(skill));
  return {
    exact: missed.length === 0 && extra.length === 0,
    rollCorrect: (expected.length > 0) === (actual.length > 0),
    truePositive: new Set(expected).size - missed.length,
    falsePositive: extra.length,
    falseNegative: missed.length,
    missed, extra,
  };
}
