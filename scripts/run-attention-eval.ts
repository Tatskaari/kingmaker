import reactions from "../evals/attention/world-reactions.json" with { type: "json" };
import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { createAttentionExperiment } from "../packages/evals/src/attention-experiment.js";
import { runEvalCli } from "../packages/evals/src/cli.js";
import cases from "../evals/attention/shared-graduation.json" with { type: "json" };

const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY to run live attention experiments.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const result = await runEvalCli([...cases, ...reactions].map(fixture => createAttentionExperiment(fixture, createAi)), { secrets: [key] });
process.exitCode = result.exitCode;
