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

test("baseline review detects the completed lift but cannot advance the quest", async () => {
  let attention = 0, reviews = 0;
  const ai: AiService = {
    decisions: async (_state, questions, _signal, purpose) => {
      if (purpose === "conversation_attention") attention++;
      return Object.fromEntries(Object.keys(questions).map(name => {
        const flagged = ["improvised_detail", "plot_progress", "other_world_update"].includes(name);
        const choice = flagged ? "flagged" : name === "immediate_feasibility" ? "not_applicable" : name.startsWith("open_") ? "skip" : "not_flagged";
        return [name, { choice, probabilities: { [choice]: 1 } }];
      }));
    },
    responses: async request => {
      reviews++;
      assert.ok(!request.tools?.some(tool => tool.function.name === "advance_quest"));
      return { role: "assistant", content: "The outcome needs an authoritative quest transition that this review cannot perform." };
    },
  };
  const experiment = createCartTreeClearanceExperiment(() => ai, ai);
  const [trial] = await runExperiment(experiment, { repeats: 1, concurrency: 1 });
  assert.equal(trial!.recording.error, undefined);
  assert.equal(trial!.scoringError, undefined);
  assert.equal(attention, 1);
  assert.equal(reviews, 3);
  assert.equal(trial!.result!.criteria["quest-advanced"]!.score, 0);
  assert.equal(trial!.result!.criteria["obstruction-cleared"]!.score, 0);
  assert.equal(trial!.result!.criteria["milestone-broadcast"]!.score, 0);
  assert.equal(trial!.result!.criteria["delivery-pending"]!.score, 1);
  assert.match(trial!.summary, /quest cart_blocked; obstruction present; milestone missing/);
});
