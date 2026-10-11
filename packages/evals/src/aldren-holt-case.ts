import { WorldHost } from "../../../apps/web/src/world-host.js";
import { planWorldAction } from "../../../apps/web/src/world-action.js";
import { fromJson } from "@bufbuild/protobuf";
import { isDeepStrictEqual } from "node:util";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import { activityGoal } from "../../lore/src/activity.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import type { AiService } from "../../conversation/src/services.js";
import { createReviewExperiment, type ReviewCase } from "./review-experiment.js";
import transcript from "../../../evals/reviews/aldren-holt/transcript.json" with { type: "json" };

export const aldrenHoltCase: ReviewCase = {
  name: "aldren-holt", characterId: "aldren", participants: ["aldren", "player"],
  transcript: transcript.map(turn => fromJson(TranscriptMessageSchema, turn)),
  expectations: "Aldren must approach Marshal Garran Holt in the Entrance Hall to order him to resolve the cushion delay. Preserve the commitment to speak to Holt; the planner receives live locations independently of current_goal. Do not claim the order is delivered or move either actor during review.",
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
export function createAldrenHoltExperiment(createAi: () => AiService) {
  const base = createReviewExperiment(aldrenHoltCase, [], createAi, createAi());
  return { ...base,
    rubric: [
      { name: "route", description: "After review, Jev chooses enter_entrance_hall to approach Holt using its current observations." },
      { name: "physical-state", description: "Review does not move actors or change the physical map." },
    ],
    getBaseline: () => recorded(base.getBaseline()),
    getVariants: () => base.getVariants().map(recorded),
    async run(runtime: import("../../conversation/src/runtime.js").ConversationRuntime, signal: AbortSignal) {
      await base.run(runtime, signal);
      const plan = await planWorldAction("aldren", runtime, signal);
      runtime.services.debug.record({ turn: 1, pass: 1, source: "aldren-holt-planner", stage: "resolve", status: "completed",
        output: { actionId: plan?.action?.id ?? plan?.decision.choice ?? "no-plan" } });
    },
    async score(recording: import("./experiment.js").RunRecording) {
      const before = recording.initialState as WorldState, after = recording.finalState as WorldState;
      const goal = after ? activityGoal(after, "aldren") ?? "" : "";
      const call = recording.getServiceRecord("debug").find(call => call.method === "record"
        && (call.args as { source?: string }[])[0]?.source === "aldren-holt-planner");
      const action = (call?.args as { output: { actionId: string } }[] | undefined)?.[0]?.output.actionId;
      return { criteria: {
        route: { score: Number(action === "enter_entrance_hall"), reason: `Selected ${action ?? "no-plan"}; goal: ${goal}` },
        "physical-state": { score: Number(!!before && !!after && isDeepStrictEqual(before.simulation!.map, after.simulation!.map)) },
      } };
    },
  };
}

function recorded(config: import("./experiment.js").RuntimeConfig) {
  return { ...config, async configure() {
    const options = await config.configure();
    return { ...options, recordServices: ["docs", "ai", "debug"] as const,
      services: { ...options.services, map: (services: import("../../conversation/src/services.js").RuntimeServices) => ({
        observe: (id: string) => new WorldHost(services.scenario.read()).map.observe(id),
      }) } };
  } };
}
