// Copied from the prototype's src/runtime/repair.ts:15-16 (NOTE_TTL_TURNS, WHISPER_TTL_TURNS) and 243-286 (expireNotes, applyRepair, moveTracker, shouldRepair) at 44c6d4a. They read and write GmState, not the session. The prototype's state.turn is `last` in the merge (the turn just finished: applyPendingRepairs ran as a turn started, before turn++) and `n` in shouldRepair (which runs once the turn is over); state.repairs.push is gone (the co_gm_result row is the record), so applyRepair returns why the tracker's move was refused, in the words the prototype added to the assessment, for the row's note; state.ended is gm.ended.

import type { RepairResult } from "../../../shared/gm/repair.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import { effectiveScene, leftBehind } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";

/**
 * The co-GM's answer, as the simulation merges it (full-gm-design §4.2): short-lived notes for the
 * GM, whispers to the cast, canon to keep true, routes and bridging beats added to the scene's
 * prep, and a forward move of the tracker. Notes expire so they can't harden into a plan the scene
 * railroads towards.
 */

export const NOTE_TTL_TURNS = 2;
export const WHISPER_TTL_TURNS = 1;

/** Notes and whispers are short-lived steering, not a plan. */
export function expireNotes(state: GmState, last: number): void {
  if (state.notesTurn !== null && last - state.notesTurn >= NOTE_TTL_TURNS) { state.notes = null; state.notesTurn = null; }
  if (state.whispers?.length) state.whispers = state.whispers.filter(w => last - w.turn < WHISPER_TTL_TURNS);
}

/** A review merged: its notes and whispers (unless newer ones are in), canon, patches, the tracker's move. Why the move was refused, if it was. */
export function applyRepair(scene: Scene, state: GmState, result: RepairResult, last: number): string | undefined {
  if (state.notesTurn === null || result.turn >= state.notesTurn) {
    state.notes = result.notes || null;
    state.notesTurn = result.notes ? result.turn : null;
    state.whispers = (result.whispers ?? []).map(w => ({ ...w, turn: result.turn }));
  }
  for (const fact of result.canon) if (!state.canon.includes(fact)) state.canon.push(fact);
  state.patches.push(...result.patches);
  const refused = result.moveTo && result.turn === last ? moveTracker(scene, state, result.moveTo, result.moveBecause, last) : undefined;
  state.lastRepairTurn = result.turn;
  return refused ? `move_to ${result.moveTo} refused: ${refused}` : undefined;
}

/**
 * The co-GM's tracker move, made if it may be: it can't take the scene back to a beat it left before
 * something was settled (the Rat's confession, undone by a move back to "Hobb gets up for work"),
 * and a word out of character isn't the scene's time passing (the Rat's bell, rung on one). Made,
 * what put the story there is a fact from then on. Why it wasn't made, if it wasn't.
 */
function moveTracker(scene: Scene, state: GmState, to: string, because: string | undefined, last: number): string | undefined {
  if (!effectiveScene(scene, state.patches).beats.some(b => b.id === to)) return "no such beat";
  if (leftBehind(state, to)) return "the scene has left it, and something has been settled since";
  if (state.oocTurns?.includes(last)) return "the turn was out of character";
  state.path.push({ turn: last, from: state.beat, to, via: "repair", source: "repair", known: state.established.length });
  if (because && !state.established.includes(because)) state.established.push(because);
  state.beat = to;
  state.turnsInBeat = 0;
  return undefined;
}

/** Gate: repair when the scene isn't on track, or periodically as a backstop. `n`: the turn just finished. */
export function shouldRepair(state: GmState, n: number, every = 3): boolean {
  if (state.ended || state.closing) return false;
  if (state.offGraphTurn === n) return true;
  return n - (state.lastRepairTurn ?? 0) >= every;
}
