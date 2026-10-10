import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../evals/actions/cressida-closed-door/fixture.json" with { type: "json" };
import corvin from "../evals/actions/corvin-nine-furrows/fixture.json" with { type: "json" };
import { createNavigationExperiment, type NavigationCase } from "../packages/evals/src/navigation-experiment.js";
import { runExperiment } from "../packages/evals/src/experiment.js";

test("navigation eval preserves the failed request and grades the resolved action", async () => {
  for (const choice of [fixture.expected, fixture.observed, "wait", "complete", "invented_action"]) {
    const experiment = createNavigationExperiment(fixture as NavigationCase, () => ({
      responses: async () => { throw Error("No dialogue should be generated"); },
      decisions: async (state, questions) => {
        assert.equal(state, fixture.request.state);
        assert.deepEqual(questions, fixture.request.questions);
        return { next: { choice, probabilities: { [choice]: 1 } } };
      },
    }));
    assert.equal(experiment.type, "jev-action");
    assert.deepEqual(experiment.getVariants(), []);
    const [trial] = await runExperiment(experiment, { repeats: 1 });
    assert.equal(trial!.result!.criteria.navigation!.score, Number(choice === fixture.expected));
    assert.equal(trial!.recording.getServiceRecord("ai").length, 1);
    assert.equal(trial!.recording.error !== undefined, choice === "invented_action");
  }
});

test("Corvin action eval accepts each delegate but rejects abandonment and unrelated targets", async () => {
  for (const choice of [...corvin.expected, corvin.observed, "follow_player", "talk_gurt", "wait", "complete", "invented_action"]) {
    const experiment = createNavigationExperiment(corvin as NavigationCase, () => ({
      responses: async () => { throw Error("No dialogue should be generated"); },
      decisions: async (state, questions) => {
        assert.equal(state, corvin.request.state);
        assert.deepEqual(questions, corvin.request.questions);
        return { next: { choice, probabilities: { [choice]: 1 } } };
      },
    }));
    assert.equal(experiment.type, "jev-action");
    assert.deepEqual(experiment.getVariants(), []);
    const [trial] = await runExperiment(experiment, { repeats: 1 });
    assert.equal(trial!.result!.criteria.navigation!.score, Number(corvin.expected.includes(choice)));
    assert.equal(trial!.recording.getServiceRecord("ai").length, 1);
    assert.equal(trial!.recording.error !== undefined, choice === "invented_action");
  }
});
