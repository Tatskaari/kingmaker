import { resolve } from "node:path";
import { jevWorldEvalScenarios } from "../evals/jev/scenarios.js";
import { runJevEval, summarizeJevEval, writeJevEvalArtifact, type JevEvalSummary } from "../packages/evals/src/jev-world-eval.js";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY to run Jev world-state evals.");
const minimal = process.argv.includes("--minimal");
const requested = process.argv.slice(2).filter(value => value !== "--minimal").map(value => value.toLowerCase());
const scenarios = requested.length ? jevWorldEvalScenarios.filter(scenario => requested.some(value => scenario.name.toLowerCase().includes(value))) : jevWorldEvalScenarios;
if (!scenarios.length) throw new Error(`No Jev eval scenario matched: ${requested.join(", ")}`);
const startedAt = new Date(), outputDirectory = resolve(process.env.JEV_EVAL_OUTPUT_DIR?.trim() || "eval-output/jev");
const summaries: JevEvalSummary[] = [];
console.log(`Jev world-state evaluations\n${startedAt.toISOString()} · output ${outputDirectory}\n`);
console.log(`Context: ${minimal ? "minimal (room-scoped scene + objective + action log)" : "runtime defaults"}\n`);
for (const scenario of scenarios) {
  console.log(`${scenario.name}\n  ${scenario.repeats ?? 10} runs · ${scenario.goal}`);
  const summary = await runJevEval(scenario, apiKey, (run, runNumber) => {
    const path = writeJevEvalArtifact(outputDirectory, startedAt, scenario, runNumber, run);
    console.log(`  ${String(runNumber).padStart(2, " ")}. ${run.score}/${run.maxScore} (${(run.scoreRate * 100).toFixed(1)}%) · ${run.success ? "PASS" : "FAIL"} · ${run.turns} turns · ${run.terminalChoice}${run.reason ? ` · ${run.reason}` : ""}\n      ${path}`);
    for (const item of run.milestones ?? []) console.log(`      ${item.achieved ? item.points : 0}/${item.points} ${item.name}`);
  }, minimal);
  summaries.push(summary);
  const successAverage = summary.averageSuccessTurns === undefined ? "n/a" : summary.averageSuccessTurns.toFixed(1);
  const failureAverage = summary.averageFailureTurns === undefined ? "n/a" : summary.averageFailureTurns.toFixed(1);
  console.log(`\n  Score: ${summary.score}/${summary.maxScore} (${(summary.scoreRate * 100).toFixed(1)}%)`);
  console.log(`  ${summary.successes}/${summary.runs.length} full success (${(summary.successRate * 100).toFixed(0)}%)`);
  console.log(`  Success: ${successAverage} turns on average`);
  console.log(`  Failure: ${failureAverage} turns on average\n`);
}
if (summaries.length > 1) {
  const runs = summaries.flatMap(summary => summary.runs), successes = runs.filter(run => run.success), failures = runs.filter(run => !run.success);
  const successTurns = successes.reduce((sum, run) => sum + run.turns, 0) / successes.length;
  const failureTurns = failures.reduce((sum, run) => sum + run.turns, 0) / failures.length;
  const summary = summarizeJevEval("Overall", runs);
  console.log(`Overall score: ${summary.score}/${summary.maxScore} (${(summary.scoreRate * 100).toFixed(1)}%)`);
  console.log(`Overall\n  ${successes.length}/${runs.length} success (${(successes.length / runs.length * 100).toFixed(0)}%)`);
  console.log(`  Success: ${successes.length ? successTurns.toFixed(1) : "n/a"} turns on average`);
  console.log(`  Failure: ${failures.length ? failureTurns.toFixed(1) : "n/a"} turns on average`);
}
if (summaries.some(summary => summary.runs.some(run => run.error))) process.exitCode = 1;
