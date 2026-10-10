import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { QuestStateSchema, QuestTrigger } from "../packages/contracts/src/v2.js";
import { classifyQuestTransitions } from "../packages/conversation/src/quest-classification.js";
import { rowanQuestFixture } from "../apps/conversation-cli/quest-fixture.js";
import { traceCliDecisions, type CliDecisionCall } from "../apps/conversation-cli/decision-calls.js";

test("quest classification batches only outgoing discretionary edges and retains evidence without progression", async () => {
  const quest = rowanQuestFixture(), edge = quest.transitions[0]!;
  quest.transitions.push({ ...edge, id: "automatic", trigger: QuestTrigger.PREDICATED },
    { ...edge, id: "future", fromStageId: "backing_out" }, { ...edge, id: "missing_trigger", trigger: QuestTrigger.UNSPECIFIED });
  const state = create(QuestStateSchema, { quest, currentStageId: "delivery_delayed", revision: 7 });
  const before = structuredClone(state), calls: CliDecisionCall[] = [];
  const messages = [{ role: "user" as const, content: "Back it out?" },
    { role: "system" as const, content: "# Binding DM ruling\nRowan declines." },
    { role: "assistant" as const, content: "No." }];
  const negative = { choice: "condition_not_met", probabilities: { condition_met: 0.1, condition_not_met: 0.9 } };
  const positive = { choice: "condition_met", probabilities: { condition_met: 0.9, condition_not_met: 0.1 } };
  const ai = traceCliDecisions({ responses: async () => assert.fail("No GM or character call"),
    decisions: async (evidence, questions, _signal, purpose) => {
      assert.equal(purpose, "quest_transition");
      assert.equal(Object.keys(questions).length, 2, "same transition ID in two quests remains independent");
      assert.match(JSON.stringify(evidence), /Binding DM ruling/);
      return { transition_0: negative, transition_1: positive };
    } }, call => calls.push(call));
  const result = await classifyQuestTransitions([state, { ...state, quest: { ...quest, id: "another_quest" } }], "rowan", messages, ai, new AbortController().signal);
  assert.deepEqual(result.map(item => [item.questId, item.transitionId, item.expectedRevision]),
    [[quest.id, edge.id, 7], ["another_quest", edge.id, 7]]);
  assert.deepEqual(result.map(item => item.decision.choice), ["condition_not_met", "condition_met"]);
  assert.deepEqual(state, before);
  assert.deepEqual(calls.map(call => call.status), ["pending", "completed"]);
  assert.equal(calls[1]?.answers?.transition_0, negative);
});

test("empty candidates skip Jev; cancellation and provider failure never change quest state", async () => {
  const state = create(QuestStateSchema, { quest: rowanQuestFixture(), currentStageId: "backing_out" });
  const ai = { decisions: async () => assert.fail("No outgoing candidates") };
  assert.deepEqual(await classifyQuestTransitions([state], "rowan", [], ai, new AbortController().signal), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(classifyQuestTransitions([], "rowan", [], ai, controller.signal), /abort/i);
  state.currentStageId = "delivery_delayed";
  const before = structuredClone(state);
  await assert.rejects(classifyQuestTransitions([state], "rowan", [], { decisions: async () => { throw Error("Offline"); } }, new AbortController().signal), /Offline/);
  assert.deepEqual(state, before);
});
