import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { aiService } from "../packages/conversation/src/adapters.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { loadPlayableWorld } from "./lib/playable-world.js";
import { createReviewExperiment } from "../packages/evals/src/review-experiment.js";
import { oswinKoboldCase } from "../packages/evals/src/oswin-kobold-case.js";
import { realityVariants, materialConsequencesVariant } from "../packages/evals/src/reality-variants.js";
import { deferredPromiseVariant } from "../packages/evals/src/deferred-promise-variant.js";
import { consequenceLedVariant } from "../packages/evals/src/consequence-led-variant.js";
import { runEvalCli } from "../packages/evals/src/cli.js";
import transcript from "../evals/reviews/oswin-parlour.json" with { type: "json" };

const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
if (!key && !process.argv.some(arg => arg === "--list" || arg === "--help")) throw new Error("Set OPENROUTER_API_KEY to run live review experiments.");
const createAi = () => aiService(new OpenRouterClient(key), new JevClient(key));
const experiment = createReviewExperiment({ name: "oswin-parlour", characterId: "oswin", participants: ["oswin", "player"],
  transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "Oswin remembers the successful intimidation and his promise to wait in the parlour, choosing the chair farthest from the door. He is still in the Great Hall. Assign an executable travel activity; do not activate a premature wait or record the journey as completed. Preserve existing characterization and private knowledge.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, overlays);
    for (const [id, y] of [["oswin", 26], ["player", 27]] as const) {
      const actor = world.map!.actors.find(actor => actor.characterId === id)!;
      actor.roomId = "great_hall";
      Object.assign(actor.position!, { x: 62, y });
    }
    world.runtimeCharacters.oswin!.activity = undefined;
    world.runtimeCharacters.oswin!.wait = undefined;
    return world;
  },
}, [deferredPromiseVariant, ...realityVariants, materialConsequencesVariant, consequenceLedVariant], createAi, createAi());
const result = await runEvalCli([experiment, createReviewExperiment(oswinKoboldCase, [deferredPromiseVariant, ...realityVariants, materialConsequencesVariant, consequenceLedVariant], createAi, createAi())], { secrets: [key] });
process.exitCode = result.exitCode;
