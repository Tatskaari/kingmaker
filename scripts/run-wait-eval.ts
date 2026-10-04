import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPlayableWorld } from "./lib/playable-world.js";
import { runTreasuryWaitEval } from "../packages/evals/src/wait-eval.js";

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("Set OPENROUTER_API_KEY to run the live wait eval.");
const repeats = Number(process.env.WAIT_EVAL_REPEATS ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error("WAIT_EVAL_REPEATS must be between 1 and 20.");
const directory = resolve(process.env.WAIT_EVAL_OUTPUT_DIR ?? "eval-output/waits");
mkdirSync(directory, { recursive: true });
const world = loadPlayableWorld();
for (let run = 1; run <= repeats; run++) {
  console.log(`Treasury wait eval ${run}/${repeats}`);
  const result = await runTreasuryWaitEval(world, key, {}, message => console.log(`  ${message}`));
  const path = `${directory}/${new Date().toISOString().replaceAll(":", "-")}-treasury-${run}.json`;
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  console.log(`${result.success ? "PASS" : "FAIL"}: ${JSON.stringify(result.milestones)}${result.error ? ` — ${result.error}` : ""}\n${path}`);
  if (!result.success) process.exitCode = 1;
}
