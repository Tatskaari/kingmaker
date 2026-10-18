import type { WorkingSet } from "../docs/types.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { playerWho, sceneEntries, scriptTranscript } from "./brief.ts";
import type { TurnView } from "./view.ts";

/**
 * The docs service's working set (docs/types.ts) from a request's view, as the prototype makes it
 * from its session (src/lore/view.ts): the game whose lore copy is read, the turn, the scene, the
 * player, who's present, and the scene so far a line an entry. Made afresh at each use.
 */
export function workingSet(scene: Scene, view: TurnView): WorkingSet {
  return {
    game: view.id,
    turn: view.turn,
    scene,
    player: { name: view.player.name, concept: view.player.concept, who: playerWho(view) },
    present: presentCast(scene, view),
    transcript: sceneEntries(view).map(e => ({ turn: e.turn, text: scriptTranscript(scene, view, [e]), ...(e.kind === "roll" ? { roll: e.text } : {}) })),
  };
}
