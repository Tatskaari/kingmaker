import { Identity } from "spacetimedb";
import type { Backstory, LoreIssue, OwnBuild, Proposal } from "../../../shared/creation/types.ts";
import type { CreationStep } from "../../../shared/protocol/keys.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import type { BuildOption, Offer } from "../../../shared/rules/types.ts";
import { Refused, type TxCtx } from "../context.ts";
import type { RowOf } from "../rows.ts";

/**
 * A `creation` row as the moves read and write it (v1-design §3.1): the caller's, its JSON columns
 * as shared/creation's and shared/rules's types, and the two ways it changes: a move, which bumps
 * `rev` (an answer asked for before it is no longer wanted), and a touch, which doesn't (the box's
 * text as it's typed, the note while the GM is out of reach, the calls an answer cost).
 */

export type CreationRow = RowOf<"creation">;

/** The caller's creation, whatever its step. */
export function creationOf(tx: TxCtx, identity: Identity): CreationRow | undefined {
  return tx.db.creation.identity.find(identity) ?? undefined;
}

/** The caller's creation, for a move on it: not_creating when they have none, or theirs is already made. */
export function creating(tx: TxCtx, identity: Identity): CreationRow {
  const row = creationOf(tx, identity);
  if (!row || row.step === "made") throw new Refused(refusal("not_creating"));
  return row;
}

/** The row moved on by a move: changed, `rev` bumped. As it stands now. */
export function moveOn(tx: TxCtx, row: CreationRow, changes: Partial<CreationRow>): CreationRow {
  return tx.db.creation.identity.update({ ...row, ...changes, rev: row.rev + 1, updatedAt: tx.now });
}

/** The row changed without moving it on: what's in flight is still wanted. */
export function touch(tx: TxCtx, row: CreationRow, changes: Partial<CreationRow>): CreationRow {
  return tx.db.creation.identity.update({ ...row, ...changes, updatedAt: tx.now });
}

// ---------------------------------------------------------------------------------------------
// The JSON columns.

export const offerOf = (row: CreationRow) => parsed<Offer>(row.offer);
export const ownOf = (row: CreationRow) => parsed<OwnBuild>(row.own);
export const chosenOf = (row: CreationRow) => parsed<BuildOption>(row.chosen);
export const proposalOf = (row: CreationRow) => parsed<Proposal>(row.proposal);
export const issuesOf = (row: CreationRow) => parsed<LoreIssue[]>(row.issues);
export const backstoryOf = (row: CreationRow) => parsed<Backstory>(row.backstory);

/** A value as its JSON column keeps it (an option: undefined stays undefined). */
export const json = <T>(value: T | undefined): string | undefined => (value === undefined ? undefined : JSON.stringify(value));

function parsed<T>(column: string | undefined): T | undefined {
  return column === undefined ? undefined : (JSON.parse(column) as T);
}

// ---------------------------------------------------------------------------------------------
// The creation's jobs.

/**
 * A creation step's plan (v1-design §3.5): the step, and the creation it was asked for, by its
 * identity (hex), uid and rev. Its request is built from the row at that rev, in the same
 * transaction; its answer lands only while the row is still there.
 */
export interface CreationPlan { step: CreationStep; identity: string; uid: string; rev: number }

/** The plan for a step of the creation as it stands. */
export const planOf = (row: CreationRow, step: CreationStep): CreationPlan => ({ step, identity: row.identity.toHexString(), uid: row.uid, rev: row.rev });

/** The creation a plan was made for, if it's still at that rev: else the player has moved it on, and the answer isn't wanted. */
export function rowAt(tx: TxCtx, plan: CreationPlan): CreationRow | undefined {
  const row = creationOf(tx, Identity.fromString(plan.identity));
  return row && row.uid === plan.uid && row.rev === plan.rev ? row : undefined;
}
