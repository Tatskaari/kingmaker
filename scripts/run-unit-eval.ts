import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { resourceReviewTools } from "../apps/web/src/resource-review.js";
import { loadEvalScenario, runUnitEval } from "../packages/evals/src/unit-eval.js";

const scenarioPath = process.argv[2] ?? "evals/witnessed-player-theft.json";
const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY to run live unit evals.");

const { scenario, transcript } = loadEvalScenario(scenarioPath);
const generator = new OpenRouterClient(apiKey);
const jev = new JevClient(apiKey);
const signal = new AbortController().signal;
let passed = 0;

for (let index = 0; index < scenario.repeats; index++) {
  const result = await runUnitEval(scenario, transcript, resourceReviewTools(), {
    generate: (model, messages, tools) => generator.complete({
      model, api: "responses", reasoning: { effort: "medium" }, messages, tools,
    }, signal),
    judge: (state, criterion) => jev.choose(state,
      `Evaluate only this scoring criterion: ${criterion.criterion}`,
      {
        meets: "The captured model response clearly meets the criterion in light of the supplied transcript.",
        does_not_meet: "The captured model response fails, contradicts, or lacks evidence for the criterion.",
      }, signal),
  });
  if (result.passed) passed++;
  console.log(`Run ${index + 1}/${scenario.repeats}: ${(result.score * 100).toFixed(1)}% ${result.passed ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(result.response, null, 2));
  for (const criterion of result.criteria) {
    console.log(`  ${(criterion.probability * 100).toFixed(1)}% [${criterion.choice}] ${criterion.criterion}`);
  }
}

console.log(`${scenario.name}: ${passed}/${scenario.repeats} runs passed at a ${(scenario.threshold * 100).toFixed(0)}% threshold.`);
if (passed !== scenario.repeats) process.exitCode = 1;
