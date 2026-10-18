// afterTurn is copied from the prototype's src/runtime/background.ts:37-48 at 44c6d4a: the jobs are queued in the turn's last commit as job rows (moves/remember.ts, moves/repair.ts), not started as detached processes, with no lock files; the approach is the prototype's `v2` (docs memory, the co-GM in the background), so neither is asked of it; `state.ended` is the scene's end, and the turn is the one just finished. mergeReviews is the prototype's applyPendingRepairs (repair.ts:226-241) as rows, called where engine.ts:452 calls it.

import type { RepairResult } from "../../../shared/gm/repair.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import type { TxCtx } from "../context.ts";
import { queueThink } from "../jobs.ts";
import { remember } from "../moves/remember.ts";
import type { SceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { applyRepair, expireNotes } from "./repair.ts";

/**
 * Background work between turns (full-gm-design §4.2), as the prototype's scene CLI does it: once a
 * player's turn is over, the memory reviews go over it, not waited on. They write the GM's notes in
 * the game's docs on the AI service's side.
 */

/** A turn's ids, as a job's plan carries them. */
export interface TurnIds { game: string; scene: string; turn: string; n: number }

/**
 * The turn's last commit (the settle, or the wind-down's reply), once its bookkeeping is written and
 * before the turn is finished: the memory reviews queued, always, their request built now, from the
 * scene as the turn left it. The two-part GM's co-GM runs in the settle (docs/two-part-design.md), so
 * no co-GM review is queued after a turn.
 */
export function afterTurn(tx: TxCtx, turn: TurnIds): void {
  queueThink(tx, remember, { step: "remember", game: turn.game, scene: turn.scene, turn: turn.turn, n: turn.n });
}

/**
 * At turn n's start: every co-GM review of the scene that has come in and waits, by the turn it
 * reviewed, merged into the bookkeeping (on the scene as authored, `last` the turn just finished),
 * its row marked with the turn that merged it, and why its move of the tracker was refused, if it
 * was; then the notes and whispers that have run their course lapse. The rows stay, as the record.
 */
export function mergeReviews(tx: TxCtx, scene: SceneRow, gm: GmState, n: number): void {
  const last = n - 1;
  const authored = sceneGraph(tx, scene, { patches: [] });
  for (const row of waitingReviews(tx, scene.id)) {
    const note = applyRepair(authored, gm, JSON.parse(row.review) as RepairResult, last);
    tx.db.coGmResult.id.update({ ...row, mergedTurn: n, note });
    tx.log(`[scene ${scene.id} turn ${n}] the co-GM's review of turn ${row.turn} merged${note ? `: ${note}` : ""}`);
  }
  expireNotes(gm, last);
}

/** The scene's reviews not merged yet, by the turn each reviewed (and as they came). */
function waitingReviews(tx: TxCtx, sceneId: bigint) {
  return [...tx.db.coGmResult.sceneId.filter(sceneId)].filter(r => r.mergedTurn === undefined).sort((a, b) => a.turn - b.turn || (a.id < b.id ? -1 : 1));
}
