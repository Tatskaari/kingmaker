import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  if (source.expected !== undefined && (!Array.isArray(source.expected)
    || source.expected.some((skill: unknown) => typeof skill !== "string" || !Object.hasOwn(conversationCheckClassifiers, skill))
    || new Set(source.expected).size !== source.expected.length)) throw new Error("expected must contain unique supported skills.");
  let input: ConversationCheckInput;
  if (source.capturedInput !== undefined) {
    if (source.transcript !== undefined) throw new Error("Choose capturedInput or transcript, not both.");
    if (typeof source.capturedInput !== "string" || !source.capturedInput.trim()) throw new Error("capturedInput must be a file path.");
    const captured = JSON.parse(readFileSync(resolve(dirname(path), source.capturedInput), "utf8"));
    if (!captured || typeof captured.playerTurn !== "string" || !captured.playerTurn.trim()
      || !Array.isArray(captured.messages) || !captured.messages.length
      || captured.messages.some((message: { role?: unknown; content?: unknown } | null) => !message
        || !["system", "user", "assistant"].includes(String(message.role)) || typeof message.content !== "string")
      || captured.messages.at(-1).role !== "user" || captured.messages.at(-1).content !== captured.playerTurn) {
      throw new Error("Captured input requires dialogue messages ending with the exact playerTurn.");
    }
    input = { playerTurn: captured.playerTurn, messages: captured.messages };
  } else {
    if (!Array.isArray(source.transcript) || source.transcript[0]?.type !== "character_conversation_sys_prompt") {
      throw new Error("Start the transcript with a scenario-backed character fixture.");
    }
    if (source.transcript.at(-1)?.type !== "user_message") throw new Error("End the transcript with the current player turn.");
    const { messages } = validateTranscript(source, path);
    input = { playerTurn: messages.at(-1)!.content!, messages };
  }
  return { name: source.name, input,
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
