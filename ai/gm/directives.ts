// Copied from the prototype at 44c6d4a: the directives' words from src/runtime/engine.ts (openingDirective, :225-228, with its after-a-boundary branch, story-design §4.4, reading the view's history and the opening the boundary rewrote; and a fight's close, FIGHT_CLOSE). The old pipeline's reply went with the rest of its scene steps (docs/migration-log.md, M2's "The old pipeline's salvage"), and with it directivesFor (the list engine.ts's playerTurn built step by step, :577-738) and the words only it said, the move's (moveDirective, with LAST_WORD) last of them: what's left is what the two-part GM reads.

import type { Exit, Scene } from "../../shared/scene/types.ts";
import type { TurnView } from "./view.ts";

export function exitOf(scene: Scene, id: string): Exit {
  const exit = scene.exits.find(e => e.id === id);
  if (!exit) throw new Error(`${scene.id} has no exit ${id}`);
  return exit;
}

// ---------------------------------------------------------------------------------------------
// The words (the prototype's, exactly).

/**
 * How a scene opens: all of its opening, none of which has happened yet, picking up from how the
 * last scene ended. "Pick up after the last scene's closing lines" beside an opening the boundary had
 * written as prose ending on the landlady's question ("Sergeant, are you on duty?") had the GM begin
 * after it, with Kell answering a question the player never heard (four Rat openings in nine).
 */
export function openingDirective(scene: Scene, state: Pick<TurnView, "history" | "opening">): string {
  if (!state.history.length) return `Open the scene. ${scene.opening} Keep it to a short paragraph or two and end on something the player can respond to.`;
  return `Open the scene: show the whole of the opening below, from its first glance to the moment it ends on. None of it has happened yet; the player sees all of it now, for the first time. It picks up from how the last scene ended (see what happened just before this scene, and where the prep is out of date: they outrank the prep), without repeating that scene's closing lines. The opening, as it stands after what actually happened: ${state.opening ?? scene.opening} Keep it to a short paragraph or two, and end on what it ends on: something the player can respond to.`;
}

export const FIGHT_CLOSE = " A fight starts here and is played out blow by blow on the map: end on the moment it breaks out, before any blow lands, any shot hits or any spell takes hold.";
