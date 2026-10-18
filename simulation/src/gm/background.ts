// afterTurn is copied from the prototype's src/runtime/background.ts:37-48 at 44c6d4a: the memory reviews are queued in the turn's last commit as a job row (moves/remember.ts), not started as a detached process, with no lock files; the approach is the prototype's `v2` (docs memory), so it isn't asked of it; the turn is the one just finished. The co-GM's review in the background (moves/repair.ts, its job) and mergeReviews (the prototype's applyPendingRepairs, repair.ts:226-241, as rows) went with the old pipeline (docs/migration-log.md, M2's "The old pipeline's salvage").

import type { TxCtx } from "../context.ts";
import { queueThink } from "../jobs.ts";
import { remember } from "../moves/remember.ts";

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
