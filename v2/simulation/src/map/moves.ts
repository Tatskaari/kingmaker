import type { Identity } from "spacetimedb";
import type { InteractArgs, TravelArgs, WalkArgs } from "../../../shared/map/moves.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "../context.ts";

/**
 * The map's moves (v2/docs/map-design.md §3.2): walk, interact and travel, each the controller's,
 * each made as the prototype's explorer makes its action of that id (shared/map/moves.ts maps the
 * arguments onto it): the ExploreState made from rows (shared/map/rows.ts exploreOf), the copied
 * act, the explore row written back, the seats moved with the map, and a scene that opens opened
 * by openLead in the same transaction. Stubs (K): package S makes them.
 */

export function walkReducer(_tx: TxCtx, _sender: Identity, _args: WalkArgs): void {
  throw new Refused(refusal("not_built"));
}

export function interactReducer(_tx: TxCtx, _sender: Identity, _args: InteractArgs): void {
  throw new Refused(refusal("not_built"));
}

export function travelReducer(_tx: TxCtx, _sender: Identity, _args: TravelArgs): void {
  throw new Refused(refusal("not_built"));
}
