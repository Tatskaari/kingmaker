import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CI's workflows (.github/workflows: check.yml, the site's preview.yml and pages.yml) as GitHub runs
 * them: each step's `run` is a bash script, and one that doesn't parse fails its job on every run.
 * Nothing else here runs those scripts before a push (a stray quote in the container job's health
 * check would have turned it red).
 */

const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");

test("every run step of CI's workflows parses in bash", () => {
  const files = readdirSync(WORKFLOWS).filter(file => file.endsWith(".yml")).sort();
  assert.ok(files.includes("check.yml") && files.length >= 3, `the workflows found: ${files.join(", ")}`);
  const checks = runSteps(readFileSync(join(WORKFLOWS, "check.yml"), "utf8"));
  assert.ok(checks.length >= 10, `only ${checks.length} run steps found in check.yml: the workflow isn't read as it's written`);

  for (const file of files) {
    for (const step of runSteps(readFileSync(join(WORKFLOWS, file), "utf8"))) {
      const parsed = spawnSync("bash", ["-n"], { input: step.script, encoding: "utf8" });
      assert.equal(parsed.status, 0, `${file}: the run step at line ${step.line} doesn't parse: ${parsed.stderr.trim()}\n${step.script}`);
    }
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
