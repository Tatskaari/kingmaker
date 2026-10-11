import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixture from "../evals/actions/cressida-closed-door/fixture.json" with { type: "json" };
import { createNavigationExperiment, type NavigationCase } from "../packages/evals/src/navigation-experiment.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { runEvalCli } from "../packages/evals/src/cli.js";
import { createCorvinNineFurrowsExperiment } from "../packages/evals/src/corvin-nine-furrows-case.js";

test("navigation CLI runs both registered cases and publishes combined results", async () => {
  const output = mkdtempSync(join(tmpdir(), "navigation-eval-"));
  const createAi = (choice: string) => () => ({
    responses: async () => { throw Error("No dialogue should be generated"); },
    decisions: async () => ({ next: { choice, probabilities: { [choice]: 1 } } }),
  });
  try {
    const result = await runEvalCli([
      createNavigationExperiment(fixture as NavigationCase, createAi(fixture.expected)),
      createCorvinNineFurrowsExperiment(createAi("talk_elinor")),
    ], { args: ["--repeats", "1", "--concurrency", "1", "--output", output], print: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(result.trials.length, 2);
    for (const trial of result.trials) assert.equal(trial.result!.criteria.navigation!.score, 1);
    const published = JSON.parse(readFileSync(join(result.directory!, "results.json"), "utf8"));
    assert.deepEqual(published.experiments, ["cressida-closed-door", "corvin-nine-furrows"]);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

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
