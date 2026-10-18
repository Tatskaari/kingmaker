// New (M6, docs/combat-design.md §1): fight_step, the scheduled reducer that plays the other side's turns one at a time (V12's "everyone else's turns run as short scheduled reducers, paced for the screen").
import type { TxCtx } from "../context.ts";
import { play } from "./rows.ts";
import { nextTurn, playersTurn, step } from "./turns.ts";

/**
 * The next of the other side's turns (fight_step, its row's): whoever's turn it is, played by the
 * AI (or the player's while they're down: its death save), then the next turn begun; the moments
 * written; and the step after scheduled, once these have had their time on screen, unless the turn
 * is now the player's or the fight is over. Its row goes as it runs (one at a time, as SpacetimeDB
 * takes a scheduled row away), and one that finds nothing to do (the fight over, or the player's
 * turn: their options are up) does nothing. A turn the rules code throws on (a bug) is passed over,
 * with nothing done in it and the module's log saying why, so a fight never stops on it.
 */
export function fightStep(tx: TxCtx, row: { scheduledId: bigint; fightId: bigint }): void {
  tx.db.fightClock.scheduledId.delete(row.scheduledId);
  const fight = tx.db.fight.id.find(row.fightId);
  if (!fight || fight.status !== "on" || fight.options) return;
  const started = tx.elapsedMs();
  const turn = fight.turn;
  try {
    play(tx, fight, s => step(s));
  } catch (e) {
    tx.log(`[fight] fight ${fight.id}: ${turn}'s turn stopped (${String(e)}): passed over`);
    play(tx, tx.db.fight.id.find(fight.id)!, s => { if (!playersTurn(s)) nextTurn(s); });
  }
  tx.log(`[fight] fight ${fight.id}: ${turn}'s turn played, ${Math.round(tx.elapsedMs() - started)} ms`);
}
