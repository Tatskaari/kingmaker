import { isDeepStrictEqual } from "node:util";
import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { WorldGameRuntime, type WorldOptions } from "../../../apps/web/src/world-runtime.js";
import { characterIntent, activityGoal } from "../../lore/src/activity.js";
import transcript from "../../../evals/reviews/oswin-parlour.json" with { type: "json" };

/** Replay the reported conversation through today's review tools, without seeding its desired activity. */
export async function runConversationReviewEval(source: WorldState, apiKey: string, options: WorldOptions = {}) {
  const world = clone(WorldStateSchema, source), id = "oswin";
  for (const [characterId, y] of [[id, 26], ["player", 27]] as const) {
    const actor = world.map!.actors.find(actor => actor.characterId === characterId)!;
    actor.roomId = "great_hall";
    Object.assign(actor.position!, { x: 62, y });
  }
  const intent = characterIntent(world, id);
  world.docs[intent.entry]!.frontmatter = { ...world.docs[intent.entry]!.frontmatter, activity: null, wait: null };
  const game = new WorldGameRuntime(world, apiKey, undefined, undefined, undefined, options);
  const before = game.snapshot();
  game.restore({ ...before, conversations: { [id]: transcript } });
  const initialMap = game.world().map;
  const milestones = { reviewCommitted: false, activityAssigned: false, noPrematureWait: false, mapUnchanged: false, plansParlourTravel: false };
  let error: string | undefined, nextChoice: string | undefined;
  const signal = AbortSignal.timeout(180_000);
  try {
    await game.endConversation(id, signal);
    milestones.reviewCommitted = !game.snapshot().conversations[id]?.length;
    milestones.activityAssigned = !!activityGoal(game.world(), id);
    milestones.noPrematureWait = !characterIntent(game.world(), id).wait;
    milestones.mapUnchanged = isDeepStrictEqual(game.world().map, initialMap);
    if (milestones.activityAssigned && milestones.noPrematureWait) {
      // Read-only planner probe: test executable travel intent, without a brittle prose matcher.
      nextChoice = (await game.planNpc(id, signal)).decision.choice;
      milestones.plansParlourTravel = ["open_guest_door_1", "enter_guest_chamber"].includes(nextChoice);
    }
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return { success: !error && Object.values(milestones).every(Boolean), milestones,
    ...(error ? { error } : {}), ...(nextChoice ? { nextChoice } : {}),
    transcript, before, snapshot: game.snapshot(), transcripts: game.recentTranscripts() };
}
