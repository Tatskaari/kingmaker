import fixture from "../evals/actions/cressida-closed-door/fixture.json" with { type: "json" };
import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { createNavigationExperiment, type NavigationCase } from "../packages/evals/src/navigation-experiment.js";
import { runEvalCli } from "../packages/evals/src/cli.js";

const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY to run navigation experiments.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const result = await runEvalCli([createNavigationExperiment(fixture as NavigationCase, createAi)], { secrets: [key] });
process.exitCode = result.exitCode;
