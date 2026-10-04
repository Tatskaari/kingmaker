import assert from "node:assert/strict";
import test from "node:test";
// Exercise the same static module shipped to the browser, without a DOM or model calls.
const { aggregateRuns } = await import(new URL("../apps/web/public/evals/aggregate.js", import.meta.url).href);
const run = (evalName: string, revision: string, score: number | null, repeats: number, criterion = "quality") => ({
  evalName, revision, publishedAt: `2026-10-0${revision}T12:00:00Z`, rubric: [{ name: criterion }],
  comparison: [{ variant: "game", baseline: true, runs: repeats, executionErrors: 0,
    scoringErrors: score === null ? 1 : 0, criteria: { [criterion]: score }, total: score, delta: score === null ? null : 0 }],
});

test("aggregate gives each eval equal weight and averages only applicable criteria", () => {
  const [result] = aggregateRuns([run("a", "1", 1, 1), run("b", "1", 0, 9, "other")], 3);
  const row = result.comparison[0];
  assert.equal(row.total, 0.5);
  assert.deepEqual(row.criteria, { other: 0, quality: 1 });
  assert.equal(row.evals, 2); assert.equal(row.expectedEvals, 3); assert.equal(row.runs, 10);
  assert.equal(result.sources.length, 2);
});

test("missing judging remains unscored and changed populations break chart lines", () => {
  const results = aggregateRuns([run("a", "2", 1, 3), run("a", "1", 1, 3), run("b", "1", null, 3)], 2);
  assert.deepEqual(results.map((item: { revision: string }) => item.revision), ["1", "2"]);
  assert.equal(results[0].comparison[0].total, null);
  assert.equal(results[0].comparison[0].scoringErrors, 1);
  assert.notEqual(results[0].comparison[0].population, results[1].comparison[0].population);
  assert.equal(results[1].comparison[0].total, 1);
});

test("variants stay separate and deltas compare only matching eval populations", () => {
  const a = run("a", "1", 0.5, 3), b = run("b", "1", 1, 3);
  a.comparison.push({ ...a.comparison[0]!, variant: "candidate", baseline: false, total: 0.75,
    criteria: { quality: 0.75 }, delta: 0.25 });
  const [result] = aggregateRuns([a, b], 2);
  const candidate = result.comparison.find((row: { variant: string }) => row.variant === "candidate");
  assert.equal(candidate.total, 0.75); assert.equal(candidate.delta, 0.25); assert.equal(candidate.evals, 1);
  assert.equal(result.comparison.find((row: { variant: string }) => row.variant === "game").total, 0.75);
});
