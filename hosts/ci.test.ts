import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CI's workflow (.github/workflows/v2.yml) as GitHub runs it: each step's `run` is a bash script,
 * and one that doesn't parse fails its job on every run. Nothing else here runs those scripts before
 * a push (a stray quote in the container job's health check would have turned it red).
 */

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "v2.yml");

test("every run step of CI's workflow parses in bash", () => {
  const steps = runSteps(readFileSync(WORKFLOW, "utf8"));
  assert.ok(steps.length >= 10, `only ${steps.length} run steps found: the workflow isn't read as it's written`);

  for (const step of steps) {
    const parsed = spawnSync("bash", ["-n"], { input: step.script, encoding: "utf8" });
    assert.equal(parsed.status, 0, `the run step at line ${step.line} doesn't parse: ${parsed.stderr.trim()}\n${step.script}`);
  }
});

test("a run step that doesn't parse is caught", () => {
  const [step] = runSteps("    steps:\n      - name: x\n        run: |\n          echo ok\n          echo '\"budget\":{'\n          grep -q 'a''\n");
  assert.notEqual(spawnSync("bash", ["-n"], { input: step!.script, encoding: "utf8" }).status, 0);
});

/** Each `run:` in a workflow, by its line: an inline command, or a block's lines (`run: |`), its indent taken off. */
function runSteps(yaml: string): Array<{ line: number; script: string }> {
  const lines = yaml.split("\n");
  const steps: Array<{ line: number; script: string }> = [];
  lines.forEach((text, i) => {
    const run = /^(\s*(?:- )?)run: (.+)$/.exec(text);
    if (run) steps.push({ line: i + 1, script: run[2]!.startsWith("|") ? blockAfter(lines, i, run[1]!.length) : run[2]! });
  });
  return steps;
}

/** A block's lines: those after its key indented deeper than the key, to the first that isn't. */
function blockAfter(lines: string[], at: number, keyColumn: number): string {
  const block: string[] = [];
  for (const text of lines.slice(at + 1)) {
    if (text.trim() && text.search(/\S/) <= keyColumn) break;
    block.push(text);
  }
  const indent = Math.min(...block.filter(l => l.trim()).map(l => l.search(/\S/)));
  return block.map(l => l.slice(indent)).join("\n");
}
