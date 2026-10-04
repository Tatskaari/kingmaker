import assert from "node:assert/strict";
import test from "node:test";
import { runExperiment, type Experiment, type RuntimeConfig } from "../packages/evals/src/experiment.js";

function fixture(): Experiment {
  const config = (name: string): RuntimeConfig => ({ name, configure() {
    let value = 0;
    const ai = { responses: async () => { value++; return { role: "assistant" as const, content: "ok" }; } };
    return { services: { ai: () => ai, character: services => ({ respond: request => services.ai.responses(request) }) }, strategies: {
      review: { classify: async () => ({ value }), resolve: async () => ({ summary: "ok" }) },
    } };
  } });
  return { name: "Example", rubric: [{ name: "quality", description: "Correct result" }],
    getBaseline: () => config("baseline"), getVariants: () => [config("candidate")],
    async run(runtime) {
      const labels = await runtime.strategies.review.classify({ characterId: "a", participants: [], transcript: [] }, new AbortController().signal, runtime.services);
      assert.equal(labels.value, 0, "Every trial receives fresh dependencies");
      await runtime.services.character.respond({ model: "test", messages: [] });
    },
    summarise: recording => `${recording.getServiceRecord("ai").length} model calls`,
    async score(recording) { return { criteria: { quality: { score: recording.getServiceRecord("ai").length === 1 ? 1 : 0 } } }; },
  };
}

test("framework constructs isolated runtimes, records nested dependencies and emits each trial", async () => {
  const emitted: string[] = [];
  const trials = await runExperiment(fixture(), { repeats: 2, onTrial: trial => { emitted.push(trial.variant); } });
  assert.equal(trials.length, 4);
  assert.deepEqual(emitted, ["baseline", "candidate", "baseline", "candidate"]);
  for (const trial of trials) {
    assert.equal(trial.result?.criteria.quality?.score, 1);
    assert.equal(trial.summary, "1 model calls");
    const ai = trial.recording.getServiceRecord("ai")[0]!;
    assert.equal(trial.recording.getCalls().find(call => call.id === ai.parentId)?.service, "character");
  }
});

test("failed executions retain calls and are scored; judge failures stay distinct", async () => {
  const experiment = fixture();
  const run = experiment.run;
  experiment.run = async (...args) => { await run(...args); throw new Error("after write"); };
  let trials = await runExperiment(experiment, { repeats: 1, variants: [] });
  assert.match(JSON.stringify(trials[0]!.recording.error), /after write/);
  assert.equal(trials[0]!.result?.criteria.quality?.score, 1);
  experiment.score = async () => { throw new Error("judge unavailable"); };
  trials = await runExperiment(experiment, { repeats: 1, variants: [] });
  assert.equal(trials[0]!.result, undefined);
  assert.match(JSON.stringify(trials[0]!.scoringError), /judge unavailable/);
});

test("timeouts retain evidence, score errors are bounded, and invalid configs fail before running", async () => {
  const experiment = fixture();
  experiment.run = async () => new Promise(() => {});
  experiment.score = async () => new Promise(() => {});
  const trials = await runExperiment(experiment, { repeats: 1, variants: [], timeoutMs: 10 });
  assert.match(JSON.stringify(trials[0]!.recording.error), /timed out/);
  assert.match(JSON.stringify(trials[0]!.scoringError), /timed out/);
  await assert.rejects(runExperiment(fixture(), { variants: ["typo"] }), /Unknown variant/);
  const bad = fixture(); bad.score = async () => ({ criteria: { quality: { score: NaN } } });
  assert.match(JSON.stringify((await runExperiment(bad, { repeats: 1, variants: [] }))[0]!.scoringError), /between 0 and 1/);
});


test("service factories reject dependency cycles before executing a trial", async () => {
  const experiment = fixture();
  experiment.getBaseline = () => ({ name: "cycle", configure: () => ({ services: {
    ai: services => { services.character.respond; return {}; },
    character: services => { services.ai.responses; return {}; },
  } }) });
  const trials = await runExperiment(experiment, { repeats: 1, variants: [] });
  assert.match(JSON.stringify(trials[0]!.recording.error), /Circular service dependency/);
});
