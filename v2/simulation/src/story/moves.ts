import type { Identity } from "spacetimedb";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "../context.ts";

/**
 * The story's moves between scenes (story-design §4.3), registered in index.ts and the memory host
 * with their arguments. Each refuses `not_built` until package B makes it here. `walk`'s arguments
 * are the map unit's (map-design §3.2): `to` a tile, `toward` "lead" (on a map, also a compass word,
 * "out" or a place); with no map, only the lead.
 */

/** walk: on to the lead, straight into its waiting scene where there's no map (openLead). The controller's. */
export function walkReducer(_tx: TxCtx, _sender: Identity, _args: { to?: { x: number; y: number } | undefined; toward?: string | undefined }): void {
  throw new Refused(refusal("not_built"));
}

/** end_scene: the scene ends through an exit now, with no closing reply (the prototype's forceEnding). The owner's, for testing. */
export function endSceneReducer(_tx: TxCtx, _sender: Identity, _args: { game: bigint; exit: string }): void {
  throw new Refused(refusal("not_built"));
}

/** carry_on: a boundary that failed, queued again. The controller's. */
export function carryOnReducer(_tx: TxCtx, _sender: Identity, _args: Record<string, never> = {}): void {
  throw new Refused(refusal("not_built"));
}

/** fight_it_out: the fight's stand-in resolves it (src/game/fight-standin.ts), and the scene picks up after it. The controller's. */
export function fightItOutReducer(_tx: TxCtx, _sender: Identity, _args: Record<string, never> = {}): void {
  throw new Refused(refusal("not_built"));
}
