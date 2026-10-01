import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { resourceReviewTools } from "../apps/web/src/resource-review.js";
import { loadEvalScenario, runUnitEvalBatch } from "../packages/evals/src/unit-eval.js";
import Table from "cli-table3";

const scenarioPaths = process.argv.slice(2);
if (scenarioPaths.length === 0) {
  scenarioPaths.push("evals/king-accusation-response.json");
}
const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY to run live unit evals.");

const generator = new OpenRouterClient(apiKey);
const jev = new JevClient(apiKey);
const signal = new AbortController().signal;
const evals = scenarioPaths.map(loadEvalScenario);
const completed = await Promise.all(evals.map(async ({ scenario, transcript, comparison }) => {
  const variants = [
    { name: "baseline", transcript },
    ...(comparison ? [{ name: comparison.name, transcript: comparison.transcript }] : []),
  ];
  return {
    scenario,
    variants: await Promise.all(variants.map(async variant => ({
      name: variant.name,
      results: await runUnitEvalBatch(scenario, variant.transcript,
        scenario.toolset === "none" ? [] : resourceReviewTools(), {
        generate: (model, messages, tools, request) => generator.complete(request ?? {
          model, api: "responses", reasoning: { effort: "medium" }, messages, tools,
        }, signal, "unit evaluation generation"),
        judge: (state, criteria) => jev.evaluate(state, Object.fromEntries(criteria.map(criterion => [criterion.id, {
          type: "choice" as const,
          instructions: `Evaluate only this scoring criterion: ${criterion.criterion}`,
          criteria: {
            meets: "The captured model response clearly meets the criterion in light of the supplied transcript.",
            does_not_meet: "The captured model response fails, contradicts, or lacks evidence for the criterion.",
          },
        }])), signal, "unit evaluation scoring"),
      }),
    }))),
  };
}));

function responseText(result: (typeof completed)[number]["variants"][number]["results"][number]): string {
  const content = result.response.content ?? "";
  try {
    const parsed = JSON.parse(content) as { utterance?: unknown };
    if (typeof parsed.utterance === "string") return parsed.utterance;
  } catch { /* Show non-JSON responses as-is. */ }
  return content || result.response.tool_calls?.map(call => `${call.function.name}(${call.function.arguments})`).join(", ") || "(empty response)";
}

const terminalWidth = Math.max(process.stdout.columns ?? 120, 80);
let failed = false;
for (const { scenario, variants } of completed) {
  console.log(`\n${scenario.name}`);
  for (const { name, results } of variants) {
    const passed = results.filter(result => result.passed).length;
    const responseTable = new Table({
      head: ["Run", "Response", "Score", "Result"],
      colWidths: [6, terminalWidth - 29, 9, 8],
      wordWrap: true,
    });
    for (const [index, result] of results.entries()) {
      responseTable.push([
        String(index + 1),
        responseText(result).replace(/\s+/g, " ").trim(),
        `${(result.score * 100).toFixed(1)}%`,
        result.passed ? "PASS" : "FAIL",
      ]);
    }

    const scoreColumnWidth = Math.max(5, Math.min(8, Math.floor((terminalWidth - 25) / (results.length + 1))));
    const scoreTable = new Table({
      head: ["Criterion", ...results.map((_, index) => `R${index + 1}`), "Mean"],
      colWidths: [terminalWidth - scoreColumnWidth * (results.length + 1), ...results.map(() => scoreColumnWidth), scoreColumnWidth],
      wordWrap: true,
    });
    for (const criterion of scenario.rubric) {
      const values = results.map(result => result.criteria.find(item => item.id === criterion.id)!.probability);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      scoreTable.push([
        criterion.id,
        ...values.map(value => `${Math.round(value * 100)}%`),
        `${Math.round(mean * 100)}%`,
      ]);
    }

    console.log(`\n${name}\n`);
    console.log(responseTable.toString());
    console.log(scoreTable.toString());
    console.log(`${passed}/${scenario.repeats} runs passed at a ${(scenario.threshold * 100).toFixed(0)}% threshold.`);
    console.log(`Mean weighted score: ${(results.reduce((sum, result) => sum + result.score, 0) / results.length * 100).toFixed(1)}%`);
    if (passed !== scenario.repeats) failed = true;
  }

  if (variants.length === 2) {
    const [baseline, patched] = variants as [typeof variants[number], typeof variants[number]];
    const comparisonTable = new Table({
      head: ["Criterion", baseline.name, patched.name, "Delta"],
      colWidths: [terminalWidth - 36, 12, 12, 12],
      wordWrap: true,
    });
    for (const criterion of scenario.rubric) {
      const mean = (results: typeof baseline.results) => results.reduce((sum, result) =>
        sum + result.criteria.find(item => item.id === criterion.id)!.probability, 0) / results.length;
      const baselineMean = mean(baseline.results), patchedMean = mean(patched.results);
      comparisonTable.push([criterion.id, `${(baselineMean * 100).toFixed(1)}%`, `${(patchedMean * 100).toFixed(1)}%`, `${((patchedMean - baselineMean) * 100).toFixed(1)}pp`]);
    }
    const meanScore = (results: typeof baseline.results) => results.reduce((sum, result) => sum + result.score, 0) / results.length;
    const baselineScore = meanScore(baseline.results), patchedScore = meanScore(patched.results);
    comparisonTable.push(["weighted_score", `${(baselineScore * 100).toFixed(1)}%`, `${(patchedScore * 100).toFixed(1)}%`, `${((patchedScore - baselineScore) * 100).toFixed(1)}pp`]);
    console.log("\nComparison\n");
    console.log(comparisonTable.toString());
  }
}
if (failed) process.exitCode = 1;
