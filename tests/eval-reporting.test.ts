import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("Jev scoring records its calls separately and refuses missing criterion answers", async () => {
  const recording = new Recording();
  const score = createJevScorer(rubric, evidence => ({ changes: evidence.finalState }), { decisions: async (state, questions) => {
    assert.deepEqual(state, { changes: { memory: "promise" } });
    assert.match(questions.criterion_0!.instructions as string, /Preserve the promise/);
    return { criterion_0: { choice: "pass", probabilities: { pass: 0.9, fail: 0.1, uncertain: 0 } } };
  } });
  const evidence = new RunRecording([], {}, { memory: "promise" });
  const result = await score(evidence, { recording, signal: new AbortController().signal });
  assert.equal(result.criteria.quality!.score, 1);
  assert.equal(recording.getServiceRecord("ai").length, 1);
  assert.equal(evidence.getCalls().length, 0);
  await assert.rejects(createJevScorer(rubric, () => ({}), { decisions: async () => ({}) })(evidence,
    { recording, signal: new AbortController().signal }), /Missing/);
});

test("CLI saves each trial and an aggregate table; list never constructs services", async () => {
  const output = mkdtempSync(join(tmpdir(), "kingmaker-eval-cli-")), lines: string[] = [];
  let constructions = 0;
  const experiment: Experiment = { name: "fixture", rubric,
    getBaseline: () => ({ name: "base", configure: () => { constructions++; return {}; } }), getVariants: () => [],
    run: async () => {}, summarise: () => "No changes", score: async () => ({ criteria: { quality: { score: 1 } } }),
  };
  try {
    await runEvalCli([experiment], { args: ["--list"], print: line => lines.push(line) });
    assert.equal(constructions, 0);
    const result = await runEvalCli([experiment], { args: ["--repeats", "2", "--output", output], print: line => lines.push(line) });
    assert.equal(constructions, 2); assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(readFileSync(`${result.directory}/0002.json`, "utf8")).repeat, 2);
    assert.equal(JSON.parse(readFileSync(`${result.directory}/results.json`, "utf8")).comparison[0].total, 1);
    assert.match(lines.join("\n"), /Experiment: fixture/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
