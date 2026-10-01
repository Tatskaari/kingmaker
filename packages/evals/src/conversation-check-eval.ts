import type { ConversationCheckInput, ConversationCheckSkill } from "../../providers/src/conversation-checks.js";

export interface ConversationCheckEvalCase {
  name: string;
  input: ConversationCheckInput;
  expected: ConversationCheckSkill[];
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
