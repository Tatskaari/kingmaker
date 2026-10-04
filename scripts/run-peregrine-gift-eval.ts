import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { createPeregrineGiftExperiment } from "../packages/evals/src/peregrine-gift-case.js";
import { realityVariants, materialConsequencesVariant } from "../packages/evals/src/reality-variants.js";
import { consequenceLedVariant } from "../packages/evals/src/consequence-led-variant.js";
import { effectLedgerVariant, sealedLedgerVariant } from "../packages/evals/src/effect-ledger-variant.js";
import { runEvalCli } from "../packages/evals/src/cli.js";

const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY to run live review experiments.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const result = await runEvalCli([createPeregrineGiftExperiment(createAi, createAi(), [...realityVariants, materialConsequencesVariant, consequenceLedVariant, effectLedgerVariant, sealedLedgerVariant])], { secrets: [key] });
process.exitCode = result.exitCode;
