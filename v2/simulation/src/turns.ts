import type { TxCtx } from "./context.ts";
import type { SceneRow, TurnRow } from "./rows.ts";

/**
 * A scene's turns: 0 is its opening, then one a line. The scene's `turnId` is the lease, the turn in
 * flight; a line said while a turn settles waits as `queued` and starts when that one is done.
 */

export type Phase = "queued" | "deciding" | "replying" | "settling" | "done" | "failed";

export function newTurn(tx: TxCtx, scene: SceneRow, playerId: bigint, n: number, phase: Phase): TurnRow {
  return tx.db.turn.insert({
    id: 0n, gameId: scene.gameId, sceneId: scene.id, n, playerId, phase, note: undefined, error: undefined,
    startedAt: tx.now, firstTextAt: undefined, endedAt: undefined, calls: 0, costMicros: 0n, notes: "none", suggest: "none", suggestAsks: 0,
  });
}

/** The line waiting for the turn in flight to finish, if there is one. */
export function queuedTurnOf(tx: TxCtx, sceneId: bigint): TurnRow | undefined {
  return [...tx.db.turn.sceneId.filter(sceneId)].filter(t => t.phase === "queued").sort((a, b) => a.n - b.n)[0];
}
