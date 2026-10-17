import { gmFromRow, gmToRow, type GmState } from "../../../shared/gm/state.ts";
import type { TxCtx } from "../context.ts";

/** A scene's GM bookkeeping, as the gm_state row keeps it (a column a field: shared/gm/state.ts). */

export function getGm(tx: TxCtx, sceneId: bigint): GmState {
  const row = tx.db.gmState.sceneId.find(sceneId);
  if (!row) throw new Error(`scene ${sceneId} has no gm_state`);
  return gmFromRow(row);
}

export function putGm(tx: TxCtx, sceneId: bigint, gm: GmState): void {
  const row = gmToRow(sceneId, gm);
  if (tx.db.gmState.sceneId.find(sceneId)) tx.db.gmState.sceneId.update(row);
  else tx.db.gmState.insert(row);
}
