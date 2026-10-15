import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./cases.ts";
import { scoreCase, summarise } from "./score.ts";
import type { StageTrace } from "./stage-trace.ts";

/**
 * Score what the stage manager actually did in play (the traced world after each turn), against
 * the same labels: a free baseline, and a check that the labels and the scorer agree with reading.
 *
 *   node --no-warnings evals/world/played.ts [runs dir with sessions/<id>/stage-trace.jsonl]
 */
const runs = process.argv[2] ?? "runs/world";
const scores = [];
for (const c of loadCases()) {
  const [session, turn] = [c.id.replace(/-t\d+$/, ""), Number(/-t(\d+)$/.exec(c.id)![1])];
  const file = join(runs, "sessions", session, "stage-trace.jsonl");
  if (!existsSync(file)) continue;
  const trace = readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l) as StageTrace).find(t => t.turn === turn);
  if (!trace) continue;
  const s = scoreCase(c, trace.worldAfter, trace.problems);
  scores.push(s);
  console.log(`${c.id}: ${s.pass ? "pass" : "FAIL"} ${s.hits}/${s.expected}${s.failures.length ? `\n  ${s.failures.map(f => `${f.class}: ${f.detail}`).join("\n  ")}` : ""}`);
}
const sum = summarise(scores);
console.log(`\nAs played: ${sum.passed}/${sum.cases} cases pass; precision ${Math.round(sum.precision * 100)}% (${sum.explained}/${sum.explained + sum.unexplained}), recall ${Math.round(sum.recall * 100)}% (${sum.hits}/${sum.expected})`);
console.log(`Failures: ${Object.entries(sum.failures).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
