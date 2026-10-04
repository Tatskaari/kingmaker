import { liveReviewVariant } from "../packages/evals/src/review-conversation.js";
import { oswinParlourCase } from "../packages/evals/src/oswin-parlour-case.js";
import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { createReviewExperiment } from "../packages/evals/src/review-experiment.js";
import { oswinKoboldCase } from "../packages/evals/src/oswin-kobold-case.js";
import { runEvalCli } from "../packages/evals/src/cli.js";

const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY to run live review experiments.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const experiment = createReviewExperiment(oswinParlourCase, [liveReviewVariant], createAi, createAi());
const result = await runEvalCli([experiment, createReviewExperiment(oswinKoboldCase, [liveReviewVariant], createAi, createAi())], { secrets: [key] });
process.exitCode = result.exitCode;
