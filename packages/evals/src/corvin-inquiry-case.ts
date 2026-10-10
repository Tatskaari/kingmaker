import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import { DocumentSchema } from "../../contracts/src/v2.js";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { AiService } from "../../conversation/src/services.js";
import { createReviewExperiment, type ReviewCase, type ReviewVariant } from "./review-experiment.js";
import type { RuntimeConfig } from "./experiment.js";
import fixture from "../../../evals/reviews/corvin-inquiry/fixture.json" with { type: "json" };

export const corvinInquiryCase: ReviewCase = {
  name: "corvin-inquiry", characterId: "corvin", participants: ["corvin", "player"],
  transcript: fixture.transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "Corvin has agreed to speak separately to Lady Elinor Ash, Professor Oswin and Doctor Rowan Ash after the current conversation, to establish what was said about his academic record. Create an active, executable first step toward talking to one of them. Preserve the overall three-person inquiry, separate accounts, motivation to establish facts and defend his reputation without an unfounded public confrontation, and unfinished progress in the activity itself so a planner without the transcript can continue. The current_goal should be an actionable next step such as finding/approaching/talking to the first person, not a guaranteed persuasion or truth-discovery outcome. Timing is immediately after this conversation, not a future-only promise. The alleged insults remain unverified: hearing giggling is not proof of its subject. Remember the commitment and reason. Do not invent answers, locations, completed interviews or movement; do not change other characters' intentions. Known locations may be included if supplied by the review's evidence; absence of a location is not an error when it was not supplied.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, overlays);
    for (const [path, document] of Object.entries(fixture.documents)) world.docs[path] = fromJson(DocumentSchema, document);
    if (world.player && world.player !== fixture.playerDocument) delete world.docs[world.player];
    world.player = fixture.playerDocument;
    world.simulation!.runtimeCharacters.player!.document = fixture.playerDocument;
    for (const actor of world.simulation!.map!.actors) {
      const captured = fixture.positions[(actor.instanceId ?? actor.characterId) as keyof typeof fixture.positions];
      if (captured) { actor.roomId = captured.roomId; Object.assign(actor.position!, captured.position); }
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
  const recordAi = (config: RuntimeConfig): RuntimeConfig => ({ ...config, async configure() {
    return { ...await config.configure(), recordServices: ["docs", "ai"] };
  } });
  return { ...base, getBaseline: () => recordAi(base.getBaseline()), getVariants: () => base.getVariants().map(recordAi) };
}
