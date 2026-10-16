import type { Identity } from "spacetimedb";
import type { Infer, ViewCtx } from "spacetimedb/server";
import { refusal } from "../../shared/protocol/refusals.ts";
import { Refused, type Schema, type TxCtx } from "./context.ts";
import type { creation, GameSummary } from "./schema.ts";

/**
 * Stand-ins for V1's moves and views until package B builds them (v1-design §3.2-3.3, §5): every
 * move refuses not_built, and both views are empty. index.ts calls the bodies at their files
 * (creation/moves.ts, games/moves.ts, views.ts), which re-export these for now; B replaces each with
 * its body, and deletes this file when none is left. Each signature is the contract: the reducer's
 * arguments as index.ts registers them.
 */

type Reducer<Args = Record<string, never>> = (tx: TxCtx, sender: Identity, args: Args) => void;

const notBuilt = (): never => {
  throw new Refused(refusal("not_built"));
};

// The creation's moves (creation/moves.ts): each for the caller's own creation row.
export const startCreationReducer: Reducer<{ campaign: string; name: string; concept: string; how: string }> = notBuilt;
export const creationBackReducer: Reducer<{ story?: string }> = notBuilt;
export const chooseBuildReducer: Reducer<{ index: number }> = notBuilt;
export const makeOwnReducer: Reducer<{ from: number }> = notBuilt;
export const pickOwnReducer: Reducer<{ speciesId: string; classId: string; subclassId?: string; backgroundId: string }> = notBuilt;
export const takeOwnReducer: Reducer = notBuilt;
export const setBackstoryReducer: Reducer<{ text: string }> = notBuilt;
export const draftBackstoryReducer: Reducer<{ text: string }> = notBuilt;
export const workInBackstoryReducer: Reducer<{ text: string }> = notBuilt;
export const takeProposalReducer: Reducer = notBuilt;
export const leaveProposalReducer: Reducer = notBuilt;
export const finishBackstoryReducer: Reducer<{ text: string }> = notBuilt;
export const acceptFixReducer: Reducer = notBuilt;
export const rewriteIssueReducer: Reducer = notBuilt;
export const skipBackstoryReducer: Reducer = notBuilt;
export const chooseAgainReducer: Reducer = notBuilt;

// The games' moves (games/moves.ts): setting off, carrying on, and deleting one.
export const beginReducer: Reducer = notBuilt;
export const continueGameReducer: Reducer<{ game: bigint }> = notBuilt;
export const deleteGameReducer: Reducer<{ game: bigint }> = notBuilt;

// The views (views.ts).
export function myCreationView(_ctx: ViewCtx<Schema>): Infer<typeof creation.rowType> | undefined {
  return undefined;
}

export function myGamesView(_ctx: ViewCtx<Schema>): Array<Infer<typeof GameSummary>> {
  return [];
}
