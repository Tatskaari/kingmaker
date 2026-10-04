import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecording, type Experiment, type Trial } from "../packages/evals/src/experiment.js";
import { compareResults, formatComparison } from "../packages/evals/src/report.js";
import { createJevScorer } from "../packages/evals/src/jev-scorer.js";
import { runEvalCli } from "../packages/evals/src/cli.js";
import { Recording } from "../packages/service-tools/src/recording.js";

const rubric = [{ name: "quality", description: "Preserve the promise", weight: 2 }];
const trial = (variant: string, score: number, error?: string): Trial => ({ experiment: "test", variant, baseline: variant === "base", repeat: 1,
  summary: "", recording: new RunRecording([], {}, {}, error), gradingCalls: [], result: { criteria: { quality: { score } } } });

test("comparison sorts weighted totals, includes failures, and leaves missing judging unranked", () => {
  const missing = trial("unscored", 1); delete missing.result; missing.scoringError = "offline";
  const rows = compareResults([trial("base", 1), trial("base", 1, "failed"), trial("candidate", 1), missing], rubric);
  assert.deepEqual(rows.map(row => row.variant), ["candidate", "base", "unscored"]);
  assert.equal(rows[1]!.total, 0.5); assert.equal(rows[0]!.delta, 0.5);
  assert.equal(rows[2]!.total, null);
  assert.match(formatComparison(rows, rubric), /Judge errors.*quality.*Total/);
});

test("Jev scoring records its calls separately and retains missing criterion answers explicitly", async () => {
  const recording = new Recording();
  const score = createJevScorer(rubric, evidence => ({ changes: evidence.finalState }), { decisions: async (state, questions) => {
    assert.deepEqual(state, { changes: { memory: "promise" } });
    assert.match(questions.criterion_0!.instructions as string, /Preserve the promise/);
    return { criterion_0: { choice: "mostly", probabilities: { mostly: 0.9, partial: 0.1 } } };
  } });
  const evidence = new RunRecording([], {}, { memory: "promise" });
  const result = await score(evidence, { recording, signal: new AbortController().signal });
  assert.equal(result.criteria.quality!.score, 0.75);
  assert.match(result.criteria.quality!.reason!, /75%/);
  assert.equal(recording.getServiceRecord("ai").length, 1);
  assert.equal(evidence.getCalls().length, 0);
  const missing = await createJevScorer(rubric, () => ({}), { decisions: async () => ({}) })(evidence,
    { recording, signal: new AbortController().signal });
  assert.equal(missing.criteria.quality!.score, null);
  assert.match(missing.criteria.quality!.reason!, /Missing/);
});

test("CLI saves each trial and an aggregate table; list never constructs services", async () => {
  const output = mkdtempSync(join(tmpdir(), "kingmaker-eval-cli-")), lines: string[] = [];
  let constructions = 0;
  const experiment: Experiment = { name: "fixture", type: "review", rubric,
    getBaseline: () => ({ name: "base", configure: () => { constructions++; return {}; } }), getVariants: () => [],
    run: async () => {}, summarise: () => "No changes", score: async () => ({ criteria: { quality: { score: 1 } } }),
  };
  try {
    await runEvalCli([experiment], { args: ["--list"], print: line => lines.push(line) });
    assert.equal(constructions, 0);
    const result = await runEvalCli([experiment], { args: ["--repeats", "2", "--output", output], print: line => lines.push(line) });
    assert.deepEqual(JSON.parse(readFileSync(`${result.directory}/manifest.json`, "utf8")).experimentTypes, { fixture: "review" });
    assert.equal(constructions, 2); assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(readFileSync(`${result.directory}/0002.json`, "utf8")).repeat, 2);
    assert.equal(JSON.parse(readFileSync(`${result.directory}/results.json`, "utf8")).comparison[0].total, 1);
    assert.equal(JSON.parse(readFileSync(`${result.directory}/manifest.json`, "utf8")).concurrency, availableParallelism());
    const serial = await runEvalCli([experiment], { args: ["--repeats", "1", "--concurrency", "1", "--output", output], print: () => {} });
    assert.equal(JSON.parse(readFileSync(`${serial.directory}/manifest.json`, "utf8")).concurrency, 1);
    await assert.rejects(runEvalCli([experiment], { args: ["--concurrency", "0"], print: () => {} }), /positive integer/);
    assert.match(lines.join("\n"), /Experiment: fixture/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});


test("CLI rejects unequal comparison populations before constructing any runtimes", async () => {
  const baseline = { name: "base", configure: () => { throw new Error("Must not construct"); } };
  const experiment: Experiment = { name: "first", type: "review", rubric, getBaseline: () => baseline, getVariants: () => [],
    run: async () => {}, summarise: () => "", score: async () => ({ criteria: {} }),
  };
  await assert.rejects(runEvalCli([experiment, { ...experiment, name: "second",
    getVariants: () => [{ ...baseline, name: "candidate" }] }], { args: [], print: () => {} }), /same selected configurations/);
});


test("accuracy uses rubric anchors rather than confidence and marks unscorable evidence explicitly", async () => {
  const evidence = new RunRecording([], {}, {});
  const context = { recording: new Recording(), signal: new AbortController().signal };
  for (const [choice, expected] of [["incorrect", 0], ["limited", 0.25], ["partial", 0.5], ["mostly", 0.75], ["complete", 1]] as const) {
    const score = createJevScorer(rubric, () => ({}), { decisions: async () => ({
      criterion_0: { choice, probabilities: { [choice]: 0.6 } },
    }) });
    assert.equal((await score(evidence, context)).criteria.quality!.score, expected);
  }
  const unscorable = createJevScorer(rubric, () => ({}), { decisions: async () => ({
    criterion_0: { choice: "unscorable", probabilities: { unscorable: 1 } },
  }) });
  assert.equal((await unscorable(evidence, context)).criteria.quality!.score, null);
});


test("CLI retains partial criterion results and includes crashed repeats as zero", async () => {
  const output = mkdtempSync(join(tmpdir(), "kingmaker-eval-partial-"));
  const criteria = [...rubric, { name: "intent", description: "Executable intent" }];
  const scorer = createJevScorer(criteria, () => ({}), { decisions: async () => ({
    criterion_0: { choice: "complete", probabilities: { complete: 1 } },
    criterion_1: { choice: "unscorable", probabilities: { unscorable: 1 } },
  }) });
  let run = 0;
  const experiment: Experiment = { name: "partial", type: "review", rubric: criteria,
    getBaseline: () => ({ name: "base", configure: () => ({}) }), getVariants: () => [],
    run: async () => { if (++run === 2) throw new Error("execution failed"); },
    summarise: () => "", score: scorer,
  };
  try {
    const result = await runEvalCli([experiment], { args: ["--repeats", "2", "--concurrency", "1", "--output", output], print: () => {} });
    assert.equal(result.exitCode, 1);
    const partial = JSON.parse(readFileSync(`${result.directory}/0001.json`, "utf8"));
    assert.equal(partial.result.criteria.quality.score, 1);
    assert.equal(partial.result.criteria.intent.score, null);
    assert.match(partial.scoringError.message, /intent/);
    const failed = JSON.parse(readFileSync(`${result.directory}/0002.json`, "utf8"));
    assert.equal(failed.result.criteria.intent.score, 0);
    const row = JSON.parse(readFileSync(`${result.directory}/results.json`, "utf8")).comparison[0];
    assert.deepEqual(row.criteria, { quality: 0.5, intent: null });
    assert.equal(row.total, null);
    assert.equal(row.executionErrors, 1);
    assert.equal(row.scoringErrors, 1);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
