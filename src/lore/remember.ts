import * as shared from "../../v2/ai/docs/remember.ts";
import type { Decider } from "../llm/decide.ts";
import type { Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { workingSet } from "./view.ts";

/**
 * The lite memory reviews live in v2/ai/docs/remember.ts, one copy shared by the prototype and v2,
 * and take the scene's working set. This adapter makes it from the scene and the session (view.ts),
 * so the prototype's calls are as they were.
 */

export { ATTENTION } from "../../v2/ai/docs/remember.ts";

export function attend(scene: Scene, state: SessionState, turn: number, decider?: Decider): Promise<string[]> {
  return shared.attend(workingSet(scene, state), turn, decider);
}

/** One turn: attention filter, then (only if flagged) the memory review. */
export function rememberTurn(scene: Scene, state: SessionState, turn: number, decider?: Decider): Promise<{ flagged: string[]; saved: string[]; costUsd: number }> {
  return shared.rememberTurn(workingSet(scene, state), turn, decider);
}

/** End of scene: what each person present carries away (one memory each, at most). */
export function rememberScene(scene: Scene, state: SessionState, ending: string): Promise<string[]> {
  return shared.rememberScene(workingSet(scene, state), ending);
}
