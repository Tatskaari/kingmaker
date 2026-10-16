import type { Identity } from "spacetimedb";
import { refusal } from "../../shared/protocol/refusals.ts";
import { Refused, type TxCtx } from "./context.ts";

/**
 * Package A's stand-in for package B's body (v5-design §5), with the signature index.ts calls it by:
 * set_suggestions refuses "not_built" until B writes it. B replaces moves/set-suggestions.ts, which
 * re-exports this until then, and deletes this file.
 */

export const setSuggestionsReducer = (_tx: TxCtx, _sender: Identity, _args: { on: boolean }): void => {
  throw new Refused(refusal("not_built"));
};
