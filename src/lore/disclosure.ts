import * as shared from "../../v2/ai/docs/disclosure.ts";
import type { Decider } from "../llm/decide.ts";
import type { Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { workingSet } from "./view.ts";

/**
 * Disclosure lives in v2/ai/docs/disclosure.ts, one copy shared by the prototype and v2, and takes
 * the scene's working set. This adapter makes it from the scene and the session (view.ts), and keeps
 * in the session what disclosure hands back, so the prototype's calls are as they were.
 */

export { OPEN_THRESHOLD, URGENT, type OpenedNote } from "../../v2/ai/docs/disclosure.ts";

/** Each scope's linked notes that bear on the moment, opened (keepOpened keeps them for the scene). */
export function disclose(scene: Scene, state: SessionState, playerTurn: string, decider?: Decider): Promise<{ opened: shared.OpenedNote[]; asked: number; latencyMs: number; costUsd: number }> {
  return shared.disclose(workingSet(scene, state), playerTurn, decider);
}

export function keepOpened(state: SessionState, notes: shared.OpenedNote[]): void {
  state.memory = shared.keepOpened(state.memory, notes);
}

/** Keep a note out of this scene however relevant it gets (closed again if it was open). */
export function withhold(state: SessionState, path: string): void {
  state.memory = shared.withhold(state.memory, path);
}

/** The GM's memory block: "stable" (each person's lore) before the conversation, "live" (memories, opened notes, the story so far) after it. */
export function memoryBrief(scene: Scene, state: SessionState, part: "stable" | "live"): string | undefined {
  return shared.memoryBrief(workingSet(scene, state), part);
}
