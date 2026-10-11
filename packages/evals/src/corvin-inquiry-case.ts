import { resolve } from "node:path";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { AiService } from "../../conversation/src/services.js";
import { createReviewExperiment, type ReviewCase, type ReviewVariant } from "./review-experiment.js";
import { loadTranscriptFixture, withTranscriptFixture } from "./transcript-fixture.js";
import captured from "../../../evals/reviews/corvin-inquiry/world.json" with { type: "json" };

const fixture = loadTranscriptFixture(resolve(import.meta.dirname, "../../../evals/reviews/corvin-inquiry/fixture.json"));

export const corvinInquiryCase: ReviewCase = {
  name: "corvin-inquiry", characterId: fixture.characterId, participants: [fixture.characterId, "player"],
  transcript: fixture.transcript,
  expectations: "Corvin has agreed to speak separately to Lady Elinor Ash, Professor Oswin and Doctor Rowan Ash after the current conversation, to establish what was said about his academic record. Create an active, executable first step toward talking to one of them. Preserve the overall three-person inquiry, separate accounts, motivation to establish facts and defend his reputation without an unfounded public confrontation, and unfinished progress in the activity itself so a planner without the transcript can continue. The current_goal should be an actionable next step such as finding/approaching/talking to the first person, not a guaranteed persuasion or truth-discovery outcome. Timing is immediately after this conversation, not a future-only promise. The alleged insults remain unverified: hearing giggling is not proof of its subject. Remember the commitment and reason. Do not invent answers, locations, completed interviews or movement; do not change other characters' intentions. Known locations may be included if supplied by the review's evidence; absence of a location is not an error when it was not supplied.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, [fixture.overlay, ...overlays]);
    if (world.player && world.player !== captured.playerDocument) delete world.docs[world.player];
    world.player = captured.playerDocument;
    world.simulation!.runtimeCharacters.player!.document = captured.playerDocument;
    for (const actor of world.simulation!.map!.actors) {
      const position = captured.positions[(actor.instanceId ?? actor.characterId) as keyof typeof captured.positions];
      if (position) { actor.roomId = position.roomId; Object.assign(actor.position!, position.position); }
    }
    const corvin = world.simulation!.runtimeCharacters.corvin!;
    corvin.activity = undefined; corvin.wait = undefined; corvin.intentRevision = 0;
    return refreshDocumentGraph(world);
  },
};

/** Keep model inputs and outputs alongside document writes for prompt comparisons. */
export function createCorvinInquiryExperiment(createAi: () => AiService, judge: Pick<AiService, "decisions">,
  variants: readonly ReviewVariant[] = []) {
  const base = createReviewExperiment(corvinInquiryCase, variants, createAi, judge);
  return { ...base, getBaseline: () => withTranscriptFixture(base.getBaseline(), fixture),
    getVariants: () => base.getVariants().map(config => withTranscriptFixture(config, fixture)) };
}
