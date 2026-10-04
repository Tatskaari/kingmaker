import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { createLiveConversationExperiment } from "../packages/evals/src/live-conversation-experiment.js";
import { oswinParlourCase } from "../packages/evals/src/oswin-parlour-case.js";
import { oswinKoboldCase } from "../packages/evals/src/oswin-kobold-case.js";
import { peregrineGiftCase } from "../packages/evals/src/peregrine-gift-case.js";
import { runEvalCli } from "../packages/evals/src/cli.js";
const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const result = await runEvalCli([oswinParlourCase, oswinKoboldCase, peregrineGiftCase]
  .map(testCase => createLiveConversationExperiment(testCase, createAi, createAi())), { secrets: [key] });
process.exitCode = result.exitCode;
