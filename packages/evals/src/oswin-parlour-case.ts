import { fromJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { ReviewCase } from "./review-experiment.js";
import transcript from "../../../evals/reviews/oswin-parlour.json" with { type: "json" };

export const oswinParlourCase: ReviewCase = { name: "oswin-parlour", characterId: "oswin", participants: ["oswin", "player"],
  transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "Oswin remembers the successful intimidation and his promise to wait in the parlour, choosing the chair farthest from the door. He is still in the Great Hall. Assign an executable travel activity; do not activate a premature wait or record the journey as completed. Preserve existing characterization and private knowledge.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, overlays);
    for (const [id, y] of [["oswin", 26], ["player", 27]] as const) {
      const actor = world.simulation!.map!.actors.find(actor => actor.characterId === id)!;
      actor.roomId = "great_hall";
      Object.assign(actor.position!, { x: 62, y });
    }
    world.simulation!.runtimeCharacters.oswin!.activity = undefined;
    world.simulation!.runtimeCharacters.oswin!.wait = undefined;
    return world;
  },
};
