import assert from "node:assert/strict";
import test from "node:test";
import type { AiService } from "../packages/conversation/src/services.js";
import { cartTreeClearanceCase, createCartTreeClearanceExperiment } from "../packages/evals/src/cart-tree-clearance-case.js";
import { runExperiment } from "../packages/evals/src/experiment.js";

test("cart tree-clearance fixture reconstructs the authoritative pre-review boundary", () => {
  const first = cartTreeClearanceCase.loadWorld([]), second = cartTreeClearanceCase.loadWorld([]);
  assert.equal(first.quests.assembly_programme!.currentStageId, "cart_blocked");
  assert.equal(first.quests.assembly_programme!.active, true);
  assert.ok(first.simulation!.map!.fixtures.some(item => item.id === "furn_cart_left"));
  assert.ok(first.simulation!.map!.fixtures.some(item => item.id === "furn_cart_right"));
  const activity = first.simulation!.runtimeCharacters.rowan!.activity!;
  assert.match(first.docs[activity]!.frontmatter!.current_goal as string, /Guide the crew/);
  first.docs[activity]!.body = "changed";
  assert.notEqual(second.docs[activity]!.body, "changed");
});

test("advance-quest candidate runs the authored clearance hook for the established tree transfer", async () => {
  let baselineReviews = 0, candidateReviews = 0, accepted = false;
  const ai: AiService = {
    decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(name =>
      [name, { choice: "not_flagged", probabilities: { not_flagged: 1 } }])),
    responses: async request => {
      assert.match(request.messages.map(message => message.content).join("\n"), /persuasion major_success/);
      assert.match(request.messages.map(message => message.content).join("\n"), /cart has stopped bracing/);
      const offered = request.tools?.some(tool => tool.function.name === "advance_quest");
      if (!offered) {
        baselineReviews++;
        return { role: "assistant", content: "The outcome needs an authoritative quest transition that this review cannot perform." };
      }
      candidateReviews++;
      const result = request.messages.findLast(message => message.role === "tool" && message.tool_call_id === "advance-tree");
      if (!result) return { role: "assistant", content: null, tool_calls: [{ id: "advance-tree", type: "function", function: {
        name: "advance_quest", arguments: JSON.stringify({ questId: "assembly_programme", transitionId: "clear_cart",
          expectedRevision: 1, evidence: "tree_transfer" }),
      } }] };
      accepted = true;
      assert.match(result.content!, /\"status\":\"accepted\"/);
      return { role: "assistant", content: "The authored clearance transition completed." };
    },
  };
  const experiment = createCartTreeClearanceExperiment(() => ai, ai);
  const trials = await runExperiment(experiment, { repeats: 1, concurrency: 1 });
  assert.equal(trials.length, 2);
  assert.equal(baselineReviews, 1);
  assert.equal(candidateReviews, 2);
  assert.equal(accepted, true);
  for (const [index, trial] of trials.entries()) {
    assert.equal(trial.recording.error, undefined);
    assert.equal(trial.scoringError, undefined);
    assert.equal(trial.result!.criteria["quest-advanced"]!.score, index);
    assert.equal(trial.result!.criteria["obstruction-cleared"]!.score, index);
    assert.equal(trial.result!.criteria["milestone-broadcast"]!.score, index);
    assert.equal(trial.result!.criteria["delivery-pending"]!.score, 1);
    assert.match(trial.summary, index
      ? /quest cart_unblocked; obstruction cleared; milestone present/
      : /quest cart_blocked; obstruction present; milestone missing/);
  }
});
