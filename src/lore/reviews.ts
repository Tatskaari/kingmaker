import * as shared from "../../v2/ai/docs/reviews.ts";
import type { Decider } from "../llm/decide.ts";
import type { Exit, Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { workingSet } from "./view.ts";

/**
 * The memory reviews (V1's attention filter and review agents) live in v2/ai/docs/reviews.ts, one
 * copy shared by the prototype and v2, and take the scene's working set. This adapter makes it from
 * the scene and the session (view.ts), so the prototype's calls are as they were.
 */

export { CATEGORIES, FLAG_THRESHOLD, plan, type ReviewRecord } from "../../v2/ai/docs/reviews.ts";

export function attend(scene: Scene, state: SessionState, turn: number, decider?: Decider): Promise<string[]> {
  return shared.attend(workingSet(scene, state), turn, decider);
}

/** One turn, V1-style: attention, then the fired reviews in order (each sees the last one's edits). */
export function reviewTurn(scene: Scene, state: SessionState, turn: number, options: { decider?: Decider; effort?: "low" | "medium" | "high" } = {}): Promise<{ flags: string[]; reviews: shared.ReviewRecord[] }> {
  return shared.reviewTurn(workingSet(scene, state), turn, options);
}

/** V1's milestone broadcast: everyone present gets one fixed memory of how the scene ended (the authored outcome). */
export function broadcastEnding(scene: Scene, state: SessionState, exit: Exit): string[] {
  return shared.broadcastEnding(workingSet(scene, state), exit);
}
