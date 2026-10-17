import type { WorkingSet } from "../../v2/ai/docs/types.ts";
import { playerWho, presentCast, scriptTranscript, sceneEntries } from "../runtime/brief.ts";
import type { Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";

/**
 * The docs service's working set (v2/ai/docs/types.ts), from a scene and the session, made with the
 * runtime's own brief.ts. Each value is read from the session when the docs service wants it, not
 * when the view is made: disclosure runs alongside a turn's decision, and its second round reads the
 * transcript and the turn as they stand by then, as it did when it read the session itself.
 */
export function workingSet(scene: Scene, state: SessionState): WorkingSet {
  return {
    get game() { return state.id; },
    get turn() { return state.turn; },
    scene,
    get player() { return { name: state.player.name, concept: state.player.concept, who: playerWho(state) }; },
    get present() { return presentCast(scene, state); },
    get transcript() { return sceneEntries(state).map(e => ({ turn: e.turn, text: scriptTranscript(scene, state, [e]), ...(e.kind === "roll" ? { roll: e.text } : {}) })); },
    get memory() { return state.memory; },
  };
}
