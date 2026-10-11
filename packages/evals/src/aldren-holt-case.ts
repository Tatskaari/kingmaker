import { fromJson } from "@bufbuild/protobuf";
import { isDeepStrictEqual } from "node:util";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import { activityGoal } from "../../lore/src/activity.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { AiService } from "../../conversation/src/services.js";
import { createReviewExperiment, type ReviewCase, type ReviewVariant } from "./review-experiment.js";
import transcript from "../../../evals/reviews/aldren-holt/transcript.json" with { type: "json" };

export const aldrenHoltCase: ReviewCase = {
  name: "aldren-holt", characterId: "aldren", participants: ["aldren", "player"],
  transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "Aldren must approach Marshal Garran Holt in the Entrance Hall to order him to resolve the cushion delay. Put enter_entrance_hall in current_goal, followed by talking to Holt. Do not claim the order is delivered or move either actor during review.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, overlays);
    const actor = world.simulation!.map!.actors.find(actor => actor.characterId === "aldren")!;
    actor.roomId = "great_hall";
    Object.assign(actor.position!, { x: 62, y: 18 });
    const runtime = world.simulation!.runtimeCharacters.aldren!;
    runtime.activity = undefined; runtime.wait = undefined;
    return world;
  },
};

/** Grade the committed planner handoff, not a model's claimed review summary. */
export function createAldrenHoltExperiment(createAi: () => AiService, variants: readonly ReviewVariant[] = []) {
  const base = createReviewExperiment(aldrenHoltCase, variants, createAi, createAi());
  return { ...base,
    rubric: [
      { name: "route", description: "The active current_goal includes enter_entrance_hall and Holt, preserving a concrete route to the person to approach." },
      { name: "physical-state", description: "Review does not move actors or change the physical map." },
    ],
    getBaseline: () => recorded(base.getBaseline()),
    getVariants: () => base.getVariants().map(recorded),
    async score(recording: import("./experiment.js").RunRecording) {
      const before = recording.initialState as WorldState, after = recording.finalState as WorldState;
      const goal = after ? activityGoal(after, "aldren") ?? "" : "";
      return { criteria: {
        route: { score: Number(/enter_entrance_hall/.test(goal) && /Holt/i.test(goal)), reason: goal || "No active goal" },
        "physical-state": { score: Number(!!before && !!after && isDeepStrictEqual(before.simulation!.map, after.simulation!.map)) },
      } };
    },
  };
}

function recorded(config: import("./experiment.js").RuntimeConfig) {
  return { ...config, async configure() {
    return { ...await config.configure(), recordServices: ["docs", "ai"] as const };
  } };
}
