import type { TxCtx } from "./context.ts";
import { queueThink } from "./jobs.ts";
import { say, startPlan } from "./moves/say.ts";
import { updateScene, updateTurn, type SceneRow, type TurnRow } from "./rows.ts";
import { playerLine } from "./transcript.ts";

/**
 * A scene's turns: 0 is its opening, then one a line. The scene's `turnId` is the lease, the turn in
 * flight; a line said while a turn settles waits as `queued` and starts when that one is done.
 */

/**
 * queued, considering (the GM rules on the act before replying: full-gm-design §4.2), replying,
 * settling, done, failed. A turn goes from queued to replying. (It was noting while its reply's notes
 * were written, until M2 took the notes out: docs/two-part-design.md; and deciding, until the old
 * pipeline's decide went with the rest of its scene steps: docs/migration-log.md.)
 */
export type Phase = "queued" | "considering" | "replying" | "settling" | "done" | "failed";

export function newTurn(tx: TxCtx, scene: SceneRow, playerId: bigint, n: number, phase: Phase): TurnRow {
  return tx.db.turn.insert({
    id: 0n, gameId: scene.gameId, sceneId: scene.id, n, playerId, phase, note: undefined, error: undefined,
    startedAt: tx.now, firstTextAt: undefined, endedAt: undefined, calls: 0, costMicros: 0n, notes: "none", suggest: "none", suggestAsks: 0, mechanic: undefined,
  });
}

/** The line waiting for the turn in flight to finish, if there is one. */
export function queuedTurnOf(tx: TxCtx, sceneId: bigint): TurnRow | undefined {
  return [...tx.db.turn.sceneId.filter(sceneId)].filter(t => t.phase === "queued").sort((a, b) => a.n - b.n)[0];
}

/** The scene's latest turn: the one whose n is the scene's `turns` (its opening, or the last line said). */
export function latestTurnOf(tx: TxCtx, scene: SceneRow): TurnRow | undefined {
  return [...tx.db.turn.sceneId.filter(scene.id)].find(t => t.n === scene.turns);
}

/** A turn's end, once all of it is in (v5-design §3.5): it's done, the lease released, and a line said meanwhile starts (unless the scene has ended). */
export function finishTurn(tx: TxCtx, sceneId: bigint, turnId: bigint): void {
  updateTurn(tx, turnId, { phase: "done", endedAt: tx.now, note: undefined });
  const scene = updateScene(tx, sceneId, { turnId: undefined });
  if (scene.status !== "ended") startQueued(tx, scene);
}

/** A line said while the last turn finished: its turn starts now, with the lease and its think. */
function startQueued(tx: TxCtx, scene: SceneRow): void {
  const queued = queuedTurnOf(tx, scene.id);
  if (!queued) return;

  updateTurn(tx, queued.id, { phase: "replying" });
  updateScene(tx, scene.id, { turnId: queued.id });
  queueThink(tx, say, startPlan(tx, scene.id, queued, playerLine(tx, scene.id, queued.n)));
}
