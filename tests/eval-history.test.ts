import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishEvalHistory } from "../scripts/publish-eval-history.js";

test("history preserves prior commits, separates experiments and replaces reruns", async () => {
  const root = mkdtempSync(join(tmpdir(), "eval-history-"));
  const source = join(root, "output"), destination = join(root, "pages");
  const run = join(source, "run"); mkdirSync(run, { recursive: true });
  const read = (path: string) => JSON.parse(readFileSync(join(destination, path), "utf8"));
  const write = (path: string, value: unknown) => writeFileSync(join(run, path), JSON.stringify(value));
  const rubric = [{ name: "accuracy", description: "Correctness" }];
  const trial = (experiment: string, score: number) => ({ experiment, variant: "game", baseline: true, repeat: 1,
    summary: "evidence", recording: { calls: [], initialState: {}, finalState: {} }, gradingCalls: [],
    result: { criteria: { accuracy: { score, reason: "Partial credit", probabilities: { partial: 1 } } } } });
  try {
    write("results.json", {});
    write("manifest.json", { revision: "a".repeat(40), rubric, experiments: ["one", "two"], repeats: 1 });
    write("0001.json", trial("one", 0.75)); write("0002.json", trial("two", 0.25));
    await publishEvalHistory(source, destination);
    const result = read(`one/${"a".repeat(40)}.json`);
    assert.equal(result.trials[0].recording, undefined);
    assert.equal(result.trials[0].gradingCalls, undefined);
    assert.deepEqual(JSON.parse(gunzipSync(readFileSync(join(destination, "one", result.trials[0].evidence))).toString()), trial("one", 0.75));
    assert.deepEqual(read("index.json"), ["one", "two"]);
    assert.equal(read(`one/${"a".repeat(40)}.json`).comparison[0].total, 0.75);
    assert.equal(read(`two/${"a".repeat(40)}.json`).trials[0].result.criteria.accuracy.reason, "Partial credit");
    write("manifest.json", { revision: "b".repeat(40), rubric, experiments: ["one"], repeats: 1 });
    const failed = { ...trial("one", 1), recording: { error: "Execution failed" } };
    write("0001.json", failed);
    await publishEvalHistory(source, destination);
    assert.equal(read(`one/${"b".repeat(40)}.json`).comparison[0].total, 0);
    write("0001.json", { ...trial("one", 1), result: undefined, scoringError: "Judge offline" });
    await publishEvalHistory(source, destination);
    assert.deepEqual(read("one/index.json"), [`${"a".repeat(40)}.json`, `${"b".repeat(40)}.json`]);
    assert.equal(read(`one/${"b".repeat(40)}.json`).comparison[0].total, null);
    assert.equal(read(`one/${"a".repeat(40)}.json`).comparison[0].total, 0.75);
    assert.deepEqual(read("two/index.json"), [`${"a".repeat(40)}.json`]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
