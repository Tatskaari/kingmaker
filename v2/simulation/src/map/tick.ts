import type { TxCtx } from "../context.ts";

/**
 * tick_place (v2/docs/town-design.md §3.5): the world's clock on a map's own place while its game's
 * host is in it, run by its place_tick row every 6 s. Package S makes it: the rounds due since
 * place.tickedAt (one each 6 s, ten at most), the scenes' own tick on the town's world when anything
 * there burns, kept in place.town; and the row taken out once nobody's there. K's stand-in does
 * nothing: nothing puts a place_tick row in until S does.
 */
export function tickPlace(_tx: TxCtx, _row: { scheduledId: bigint; placeId: bigint }): void {
  // Not built: package S's.
}
