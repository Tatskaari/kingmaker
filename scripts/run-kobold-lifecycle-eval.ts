import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { createKoboldLifecycleExperiment } from "../packages/evals/src/kobold-lifecycle-experiment.js";
import { runEvalCli } from "../packages/evals/src/cli.js";

const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY to run live experiments.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const result = await runEvalCli([createKoboldLifecycleExperiment(createAi, createAi())], { secrets: [key] });
process.exitCode = result.exitCode;
