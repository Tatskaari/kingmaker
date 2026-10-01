import assert from "node:assert/strict";
import test from "node:test";
import { conversationCheckEvalCases } from "../evals/jev/conversation-checks.js";
import { scoreConversationChecks } from "../packages/evals/src/conversation-check-eval.js";
import { conversationCheckClassifiers } from "../packages/providers/src/conversation-checks.js";

test("classification scoring distinguishes roll detection from skill accuracy", () => {
  assert.deepEqual(scoreConversationChecks(["deception", "sleight_of_hand"], ["deception", "intimidation"]), {
    exact: false, rollCorrect: true, truePositive: 1, falsePositive: 1, falseNegative: 1,
    missed: ["sleight_of_hand"], extra: ["intimidation"],
  });
  assert.equal(scoreConversationChecks([], []).exact, true);
  assert.equal(scoreConversationChecks([], ["persuasion"]).rollCorrect, false);
  assert.equal(scoreConversationChecks(["insight"], []).rollCorrect, false);
  assert.equal(scoreConversationChecks(["deception", "insight"], ["insight", "deception"]).exact, true);
});

test("fixtures cover every skill, multi-check turns, and no-check conversations", () => {
  assert.equal(new Set(conversationCheckEvalCases.map(item => item.name)).size, conversationCheckEvalCases.length);
  const covered = new Set(conversationCheckEvalCases.flatMap(item => item.expected));
  assert.deepEqual([...covered].sort(), Object.keys(conversationCheckClassifiers).sort());
  assert.ok(conversationCheckEvalCases.some(item => item.expected.length > 1));
  assert.ok(conversationCheckEvalCases.some(item => !item.expected.length && item.input.history?.length));
  assert.ok(conversationCheckEvalCases.some(item => !item.expected.length && item.input.messages?.length));
  for (const item of conversationCheckEvalCases) {
    assert.ok(item.input.playerTurn.trim());
    assert.equal(new Set(item.expected).size, item.expected.length);
  }
});
