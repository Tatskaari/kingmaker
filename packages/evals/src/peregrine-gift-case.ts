import { renderPrompt } from "../../prompts/src/index.js";
import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import type { AiService } from "../../conversation/src/services.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import { createReviewExperiment, type ReviewCase, type ReviewVariant } from "./review-experiment.js";
import transcript from "../../../evals/reviews/peregrine-gift/transcript.json" with { type: "json" };

export const peregrineGiftCase: ReviewCase = {
  name: "peregrine-gift", characterId: "peregrine", participants: ["peregrine", "player"],
  transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "The player requested a small, valueless curio and Peregrine willingly gave them a carved wooden bird with faded blue lacquer on its wings. The intended outcome is a completed gift: persist exactly one bird in the player's actual inventory, not merely an offer or a memory of a transfer. Do not leave a duplicate bird in Peregrine's inventory or schedule a later handoff. Preserve the friendly interaction in Peregrine's memory. The bird was introduced in this dialogue and is absent from the starting inventories; do not reject the harmless gift solely for that reason. Its supposed eastern origin and Abel's role are Peregrine's account, not independently verified history. No roll or GM ruling is present. Preserve unrelated possessions and state; do not invent value, magical powers, an artisan's identity, or distant events.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, overlays);
    for (const [id, y] of [["peregrine", 26], ["player", 27]] as const) {
      const actor = world.simulation!.map!.actors.find(actor => actor.characterId === id)!;
      actor.roomId = "great_hall";
      Object.assign(actor.position!, { x: 62, y });
    }
    const actor = world.simulation!.runtimeCharacters.peregrine!;
    actor.activity = undefined; actor.wait = undefined; actor.intentRevision = 0;
    return world;
  },
};

/** Typed possessions are authoritative; prose claiming a gift is insufficient. */
export function giftInventoryScore(world: WorldState | undefined) {
  const count = (id: string) => (world?.simulation?.runtimeCharacters[id]?.inventory?.items ?? [])
    .filter(item => /\bbird\b/i.test(`${item.name} ${item.details}`) && /\bwood(?:en)?\b/i.test(`${item.name} ${item.details}`))
    .reduce((total, item) => total + (item.quantity ?? 1), 0);
  const player = count("player"), giver = count("peregrine");
  return { score: player === 1 && giver === 0 ? 1 : 0,
    reason: `Matching wooden birds: player=${player}, Peregrine=${giver}; expected 1 and 0.` };
}

export function createPeregrineGiftExperiment(createAi: () => AiService, judge: Pick<AiService, "decisions">, variants: readonly ReviewVariant[] = []) {
  const base = createReviewExperiment(peregrineGiftCase, variants, createAi, judge);
  return { ...base, rubric: [...base.rubric, { name: "gift-inventory", description: renderPrompt("peregrine-gift-case-description-1") }],

    async score(...args: Parameters<typeof base.score>) {
      const result = await base.score(...args);
      result.criteria["gift-inventory"] = giftInventoryScore(args[0].finalState as WorldState | undefined);
      return result;
    } };
}
