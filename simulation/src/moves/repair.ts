import type { RepairResult } from "../../../shared/gm/repair.ts";
import type { ScenePatch } from "../../../shared/gm/state.ts";
import type { RepairResponse } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { repairCall } from "../gm/requests.ts";
import type { Move } from "./move.ts";
import type { RepairPlan } from "./plans.ts";

/**
 * The background co-GM's review of a turn once it's over (full-gm-design §4.2; the prototype's
 * repairJob, jobs.ts:94-105, as a job in the background): queued in the turn's last commit when
 * shouldRepair says so (gm/background.ts afterTurn), POST /v1/turns/repair with the scene as the
 * turn left it. Its answer waits in a co_gm_result row, as the prototype's repair-NNN.json did,
 * until the next turn's start merges it into gm_state (say.ts startPlan); the row stays as the
 * record. A scene that has ended merges nothing more. Shaped as V5's notes and suggest are: in the
 * background, never the turn's failure, nothing on screen; one that can't be had is given up.
 */
export const repair: Move<void, RepairPlan> = {
  name: "repair",
  background: true,

  resolve() {
    throw new Error("the co-GM's review is queued by a turn's last commit, never made as a move");
  },

  think: (tx, plan) => repairCall(tx, plan),

  /** Always: the review is kept whatever has happened since (a later turn's start merges it). */
  applies: () => true,

  commit(tx, plan, answer) {
    const review = reviewOf((answer as Partial<RepairResponse>).review);
    const sceneId = idOf(plan.scene);
    const scene = tx.db.scene.id.find(sceneId);
    if (!scene) {
      tx.log(`[scene ${plan.scene} turn ${plan.n}] the co-GM's review is dropped: the scene is gone`);
      return { done: true };
    }

    tx.db.coGmResult.insert({ id: 0n, sceneId, turn: plan.n, review: JSON.stringify({ ...review, turn: plan.n }), mergedTurn: undefined, note: undefined, at: tx.now });
    tx.log(`[scene ${plan.scene} turn ${plan.n}] the co-GM: ${review.status}, ${review.patches.length} patches${scene.status === "ended" ? " (the scene has ended: it won't be merged)" : ""}`);
    return { done: true };
  },

  /** The prototype's job wrote no review when it failed: the scene goes on without one. */
  giveUp(tx, plan, why) {
    tx.log(`[scene ${plan.scene} turn ${plan.n}] the co-GM's review gave up: ${why}`);
  },
};

/** The answer's review, checked enough that the merge at a turn's start can't throw on it (and so refuse a line). */
function reviewOf(review: RepairResult | undefined): RepairResult {
  const ok = !!review && typeof review === "object" && typeof review.status === "string" && typeof review.notes === "string" && typeof review.assessment === "string"
    && Array.isArray(review.canon) && review.canon.every(c => typeof c === "string")
    && Array.isArray(review.patches) && review.patches.every(patchOk)
    && (review.whispers === undefined || (Array.isArray(review.whispers) && review.whispers.every(w => typeof w?.to === "string" && typeof w.note === "string")));
  if (!ok) throw new Error("the answer has no review");
  return review;
}

/** A patch the scene's graph can take (shared/scene/graph.ts effectiveScene): a route with its beat and id, a beat with its id and routes. */
function patchOk(patch: ScenePatch): boolean {
  if (!patch || typeof patch !== "object" || typeof patch.turn !== "number" || typeof patch.why !== "string") return false;
  if (patch.transition && (typeof patch.transition.beat !== "string" || typeof patch.transition.transition?.id !== "string")) return false;
  return !patch.beat || (typeof patch.beat.id === "string" && Array.isArray(patch.beat.transitions));
}
