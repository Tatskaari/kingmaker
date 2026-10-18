// Copied from the prototype at 44c6d4a: the directives' words from src/runtime/director.ts:1021-1035, 1096-1097, 1190-1191, 1201-1211, 1387-1410 and src/runtime/engine.ts:225-228, 255-328, 586, 706, 728, 1329 (openingDirective with its after-a-boundary branch, story-design §4.4, reading the view's history and the opening the boundary rewrote). The old pipeline's reply went with the rest of its scene steps (docs/migration-log.md, M2's "The old pipeline's salvage"), and with it directivesFor (the list engine.ts's playerTurn built step by step, :577-738) and the words only it said: what's left is what the two-part GM and the scene steps still to go read.

import type { RollResult } from "../../shared/dice.ts";
import { describeRoll, titleCase } from "../../shared/dice.ts";
import type { Exit, Scene, Transition } from "../../shared/scene/types.ts";
import type { TurnView } from "./view.ts";

/**
 * Every word the GM is told to do in a reply. Some are matched by their opening words elsewhere
 * ("This reply closes the scene", "The scene is ending": brief.ts's `closes`), so each string is
 * the prototype's exactly: a reworded directive breaks a match without an error.
 */

/** What the director decided this turn, and what the GM must make happen (director.ts's Move). */
export interface Move {
  transition: Transition;
  phase: "attempt" | "cue" | "outcome";
  roll?: RollResult;
  /** Beat or exit id we end up at (may equal the current beat after a failed check). */
  to: string;
  exit?: Exit;
  /** The player chose this outcome (their own attempt, and the dice didn't say otherwise). */
  chosen: boolean;
}

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

/**
 * A reply that closes the scene answers the player's turn first: what they ask someone here is
 * answered, and a challenge to someone in the room lands (Brother Ambrose's "Sallow." to the man in
 * the doorway got a polite nod and the procession).
 */
export const LAST_WORD = "Answer the player's turn first: if they ask someone here something, or challenge or call someone out, that person hears it and answers in their own way and character (a reaction, a retort, a slip), so it lands, though the ending stands.";

/** How the GM is told about a move. */
export function moveDirective(scene: Scene, state: Pick<TurnView, "beat">, move: Move): string[] {
  const lines: string[] = [];
  if (move.roll && move.transition.check) {
    const check = move.transition.check;
    lines.push(`The player's attempt called for a ${titleCase(move.roll.skill)} check${check.reason ? ` ${check.reason.replace(/\.$/, "")}` : ` (${move.transition.when.replace(/\.$/, "")})`}. ${describeRoll(move.roll)}. ${move.roll.success ? check.success : check.failure}${move.roll.skill !== check.skill ? ` The player went about it by ${move.roll.skill} rather than ${check.skill}: the outcome is the same, but it lands the way their method would (a threat that works frightens and leaves resentment; a lie that works is believed, for now).` : ""} Narrate this result so the player can see what was at stake and why it went the way it did.`);
  }
  if (move.exit && !move.chosen) {
    lines.push(`Things are escalating towards this: ${move.exit.outcome} Don't let it happen yet. In this reply, escalate (a warning, a last demand, a countdown, a weapon raised) and stop with the moment hanging: the next move is the player's.`);
  } else if (move.exit) {
    lines.push(`This reply closes the scene: ${move.exit.outcome} ${LAST_WORD} Land it on a moment that belongs to the player. What this ending should feel like: ${move.exit.closing} Don't narrate beyond the ending into what comes next.${move.exit.kind === "combat" ? " A fight starts here and is played out blow by blow on the map: end on the moment it breaks out, before any blow lands, any shot hits or any spell takes hold." : ""}`);
  } else if (move.to !== state.beat) {
    const beat = scene.beats.find(b => b.id === move.to)!;
    lines.push(`The scene has moved on to "${beat.title}": ${beat.direction} Play the start of this in your reply, growing out of what the player just did, and let the rest unfold over the next exchanges.`);
  }
  return lines;
}
