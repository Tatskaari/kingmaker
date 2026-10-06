import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import { DocumentSchema } from "../../contracts/src/v2.js";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { ReviewCase } from "./review-experiment.js";
import fixture from "../../../evals/reviews/oswin-kobold-city/fixture.json" with { type: "json" };

/** Replay the review boundary, before its off-map activity and subsequent navigation loop. */
export const oswinKoboldCase: ReviewCase = {
  name: "oswin-kobold-city", characterId: "oswin", participants: ["oswin", "player"],
  transcript: fixture.transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "Preserve Oswin's enthusiastic agreement to accompany Berz to Kobold City for fashion advice and the binding major-success persuasion ruling. Kobold City is not a destination in the current playable map. Preserve the unfinished promise without activating an immediate journey to an unsupported destination or inventing an exit or route. A bounded next step supported by current observations, or deferral until an actionable route or departure arrangement exists, is acceptable. Do not undo the successful agreement, claim the journey or consultation is complete, or declare that the city cannot exist in the wider fictional world. Oswin is still in the Great Hall; Berz has not departed.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, overlays);
    // Explicit captured preconditions, not the post-review memory/activity in the saved game.
    for (const [path, document] of Object.entries(fixture.documents)) world.docs[path] = fromJson(DocumentSchema, document);
    if (world.player && world.player !== fixture.playerDocument) delete world.docs[world.player];
    world.player = fixture.playerDocument;
    for (const [id, position] of Object.entries(fixture.positions)) {
      const actor = world.simulation!.map!.actors.find(actor => actor.characterId === id)!;
      actor.roomId = "great_hall";
      Object.assign(actor.position!, position);
    }
    const oswin = world.simulation!.runtimeCharacters.oswin!;
    oswin.activity = undefined; oswin.wait = undefined; oswin.intentRevision = 0;
    return refreshDocumentGraph(world);
  },
};
