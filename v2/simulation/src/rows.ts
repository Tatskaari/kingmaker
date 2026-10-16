import type { Identity } from "spacetimedb";
import type { Db, TxCtx } from "./context.ts";

/**
 * The module's rows by table, and the lookups every move makes. A lookup that must succeed (a
 * scene's game, a turn's scene) throws when it doesn't: that's a bug, not a refusal, and it fails
 * the call (or, in a commit, the turn).
 */

/** A table's row as the module reads and writes it. */
export type RowOf<T extends keyof Db> = Db[T] extends { insert(row: infer R): unknown } ? R : never;

export type GameRow = RowOf<"game">;
export type PlayerRow = RowOf<"player">;
export type SceneRow = RowOf<"scene">;
export type TurnRow = RowOf<"turn">;
export type JobRow = RowOf<"job">;
export type PlaceRow = RowOf<"place">;
export type SheetRow = RowOf<"sheet">;
export type CampaignRow = RowOf<"campaign">;
export type SceneDefRow = RowOf<"sceneDef">;

const must = <T>(row: T | null | undefined, what: string): T => {
  if (row === null || row === undefined) throw new Error(`no ${what}`);
  return row;
};

export const gameRow = (tx: TxCtx, id: bigint): GameRow => must(tx.db.game.id.find(id), `game ${id}`);
export const playerRow = (tx: TxCtx, id: bigint): PlayerRow => must(tx.db.player.id.find(id), `player ${id}`);
export const sceneRow = (tx: TxCtx, id: bigint): SceneRow => must(tx.db.scene.id.find(id), `scene ${id}`);
export const turnRow = (tx: TxCtx, id: bigint): TurnRow => must(tx.db.turn.id.find(id), `turn ${id}`);
export const placeRow = (tx: TxCtx, id: bigint): PlaceRow => must(tx.db.place.id.find(id), `place ${id}`);
export const sheetRow = (tx: TxCtx, playerId: bigint): SheetRow => must(tx.db.sheet.playerId.find(playerId), `sheet for player ${playerId}`);

/** The scene a player is in now, if any. */
export function sceneOfPlayer(tx: TxCtx, playerId: bigint | undefined): SceneRow | undefined {
  const player = playerId === undefined ? undefined : tx.db.player.id.find(playerId);
  return player?.sceneId === undefined ? undefined : (tx.db.scene.id.find(player.sceneId) ?? undefined);
}

/** A scene's row changed, as it stands now in this transaction: every write bumps its rev, so a client can tell one state from the next. */
export function updateScene(tx: TxCtx, id: bigint, changes: Partial<SceneRow>): SceneRow {
  const scene = sceneRow(tx, id);
  return tx.db.scene.id.update({ ...scene, ...changes, rev: scene.rev + 1 });
}

/** A turn's row changed, as it stands now in this transaction. */
export function updateTurn(tx: TxCtx, id: bigint, changes: Partial<TurnRow>): TurnRow {
  return tx.db.turn.id.update({ ...turnRow(tx, id), ...changes });
}

/** A connection's seat: the player it plays as now, in place of any it had (that player is no longer online: nobody plays it). */
export function seatPlayer(tx: TxCtx, identity: Identity, playerId: bigint): void {
  const seat = tx.db.seat.identity.find(identity);
  const before = seat && seat.playerId !== playerId ? tx.db.player.id.find(seat.playerId) : undefined;
  if (before?.online) tx.db.player.id.update({ ...before, online: false });

  if (seat) tx.db.seat.identity.update({ identity, playerId });
  else tx.db.seat.insert({ identity, playerId });
}
