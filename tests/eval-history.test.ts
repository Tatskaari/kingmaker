import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishEvalHistory, updateEvalTypes } from "../scripts/publish-eval-history.js";

test("history preserves prior commits, separates experiments and replaces reruns", async () => {
  const root = mkdtempSync(join(tmpdir(), "eval-history-"));
  const source = join(root, "output"), destination = join(root, "pages");
  const run = join(source, "run"); mkdirSync(run, { recursive: true });
  const read = (path: string) => JSON.parse(readFileSync(join(destination, path), "utf8"));
  const write = (path: string, value: unknown) => writeFileSync(join(run, path), JSON.stringify(value));
  const rubric = [{ name: "accuracy", description: "Correctness" }];
  const trial = (experiment: string, score: number) => ({ experiment, variant: "game", baseline: true, repeat: 1,
    summary: "evidence", recording: { calls: [], initialState: { large: "recording-only".repeat(10000) }, finalState: {} }, gradingCalls: [{ payload: "judge-recording-only" }],
    result: { criteria: { accuracy: { score, reason: "Partial credit", probabilities: { partial: 1 } } } } });
  try {
    write("results.json", {});
    write("manifest.json", { revision: "a".repeat(40), rubric, experiments: ["one", "two"], repeats: 1 });
    write("0001.json", trial("one", 0.75)); write("0002.json", trial("two", 0.25));
    await publishEvalHistory(source, destination);
    const result = read(`one/${"a".repeat(40)}.json`);
    assert.ok(readFileSync(join(destination, "one", `${"a".repeat(40)}.json`)).length < 5000);
    assert.equal(result.trials[0].recording, undefined);
    assert.equal(result.trials[0].gradingCalls, undefined);
    assert.equal(result.trials[0].evidence, undefined);
    assert.deepEqual(readdirSync(join(destination, "one")).sort(), [`${"a".repeat(40)}.json`, "index.json"]);
    assert.deepEqual(JSON.parse(readFileSync(join(run, "0001.json"), "utf8")), trial("one", 0.75));
    assert.deepEqual(read("index.json"), ["one", "two"]);
    assert.equal(read(`one/${"a".repeat(40)}.json`).comparison[0].total, 0.75);
    assert.equal(read(`two/${"a".repeat(40)}.json`).trials[0].result.criteria.accuracy.reason, "Partial credit");
    write("manifest.json", { revision: "b".repeat(40), rubric, experiments: ["one"], experimentTypes: { one: "review" }, repeats: 1 });
    const failed = { ...trial("one", 1), recording: { error: "Execution failed" } };
    write("0001.json", failed);
    await publishEvalHistory(source, destination);
    assert.equal(read(`one/${"b".repeat(40)}.json`).comparison[0].total, 0);
    write("0001.json", { ...trial("one", 1), result: undefined, scoringError: "Judge offline" });
    await publishEvalHistory(source, destination);
    assert.deepEqual(read("one/index.json"), [`${"a".repeat(40)}.json`, `${"b".repeat(40)}.json`]);
    assert.equal(read(`one/${"b".repeat(40)}.json`).comparison[0].total, null);
    assert.equal(read(`one/${"a".repeat(40)}.json`).comparison[0].total, 0.75);
    assert.equal(read(`one/${"b".repeat(40)}.json`).type, "review");
    const before = read(`one/${"a".repeat(40)}.json`);
    updateEvalTypes(destination, { one: "review" });
    assert.deepEqual(read(`one/${"a".repeat(40)}.json`), { ...before, type: "review" });
    assert.deepEqual(read("types.json"), { one: "review", two: "unclassified" });
    updateEvalTypes(destination, { one: "jev-action", two: "jev-decision" });
    assert.equal(read(`one/${"a".repeat(40)}.json`).type, "review");
    assert.equal(read(`two/${"a".repeat(40)}.json`).type, "jev-decision");
    assert.deepEqual(read("two/index.json"), [`${"a".repeat(40)}.json`]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
