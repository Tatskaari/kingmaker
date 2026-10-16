import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type Actor, type TxCtx } from "../context.ts";
import type { GameRow } from "../rows.ts";

/**
 * The one way into a scene (v2/docs/map-design.md §3.5): the lead's waiting scene (game.leadScene)
 * opened through V0's openScene, with what the character starts with on the game's first scene;
 * every seat of the game moved into it, and the explore row's scene and spot set (enterScene). The
 * map's triggers call it (a step into the yard, a word with Kell) in the same transaction as the
 * move, and so does the whole story's Go on (V3: walk toward the lead where there's no map).
 * A stub (K): package S makes it.
 */
export function openLead(_tx: TxCtx, _actor: Actor, _game: GameRow): void {
  throw new Refused(refusal("not_built"));
}
