import type { Identity } from "spacetimedb";
import type { Tile2 } from "../../../shared/map/types.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "../context.ts";

/**
 * The map's action menu as moves (v2/docs/town-design.md §3.2): the rules on the town's world, each
 * one to one with the prototype's menu ids (shared/map/moves.ts actionId and moveOf). K's stand-ins:
 * each refuses `not_built` until package S makes it the walker's move: the ExploreState from rows
 * (the town's changes in its overlay), the menu's keep from the explore row, storyRoute first (a
 * waiting scene's people open their scene, the act its first turn; Kell, a talk), else doMenuAct; what
 * it said on the explore row, the town on its place (place.town), the sheet, rules_state and dice
 * written; refused in the prototype's words (§3.2's codes). The arguments are the reducers' (index.ts):
 * `how` and `length` are checked by the move.
 */

/** cast_<spell>, cast_<spell>_self, cast_<spell>@x,y: a spell, aimed at a tile, at yourself, or not at all. */
export function castReducer(_tx: TxCtx, _sender: Identity, _args: { spell: string; at?: Tile2 | undefined; self?: boolean | undefined }): void {
  notBuilt();
}

/** attack@x,y, throw@x,y, shove@x,y, grapple@x,y, lift@x,y: a blow, a throw, a shove, a grab, a pocket picked, at a tile. `how` is the id's first word. */
export function attackReducer(_tx: TxCtx, _sender: Identity, _args: { how: string; at: Tile2 }): void {
  notBuilt();
}

/** feature_<id>, feature_<id>_self, feature_<id>@x,y: a class feature with uses, aimed as a spell is. */
export function useFeatureReducer(_tx: TxCtx, _sender: Identity, _args: { feature: string; at?: Tile2 | undefined; self?: boolean | undefined }): void {
  notBuilt();
}

/** jump@x,y: a leap to a tile in reach (the rules' jump: farther takes Athletics). */
export function leapReducer(_tx: TxCtx, _sender: Identity, _args: { at: Tile2 }): void {
  notBuilt();
}

/** hide: a Stealth check against whoever's watching; out of sight until they move or do something. */
export function hideReducer(_tx: TxCtx, _sender: Identity, _args: Record<string, never> = {}): void {
  notBuilt();
}

/** rest_short, rest_short_recover, rest_long: an hour (and Arcane Recovery), a night; once each before the clock moves on. `length`: short, long. */
export function restReducer(_tx: TxCtx, _sender: Identity, _args: { length: string; recover?: boolean | undefined }): void {
  notBuilt();
}

/** use_<item>: something carried that's used up (a potion), by the engine's instance id. */
export function useItemReducer(_tx: TxCtx, _sender: Identity, _args: { item: string }): void {
  notBuilt();
}

function notBuilt(): never {
  throw new Refused(refusal("not_built"));
}
