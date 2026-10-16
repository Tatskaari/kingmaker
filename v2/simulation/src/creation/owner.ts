import type { CreationStep } from "../../../shared/protocol/keys.ts";
import { LOST_THREAD } from "../jobs.ts";
import type { JobOwner } from "../moves/move.ts";
import { moveOn, rowAt, touch, type CreationPlan, type CreationRow } from "./rows.ts";

/**
 * Whose a creation step's job is (v1-design §3.5): the creation row's, while it's still at the rev
 * the step was asked at. Its answer is wanted only then (a pick overtaken by another is dropped, as
 * the prototype drops it: game.ts:582); the note on the creation screens says when the GM is out of
 * reach and trying again; what each answer cost goes on the row; and a step that fails for good
 * leaves the GM idle with the player's words in the note, back where there's something to show.
 */
export const creationOwner: JobOwner<CreationPlan> = {
  wanted: (tx, plan) => !!rowAt(tx, plan),

  /** The waiting note, or, when the answer came, that note cleared (any other note is the moves'). */
  waiting(tx, plan, note) {
    const row = rowAt(tx, plan);
    if (!row) return;
    const now = note ?? (row.note === LOST_THREAD ? undefined : row.note);
    if (now !== row.note) touch(tx, row, { note: now });
  },

  charge(tx, plan, usage) {
    const row = rowAt(tx, plan);
    if (row) touch(tx, row, { calls: row.calls + usage.calls, costMicros: row.costMicros + BigInt(Math.round(usage.costUsd * 1_000_000)) });
  },

  failed(tx, plan, words) {
    const row = rowAt(tx, plan);
    if (row) moveOn(tx, row, { busy: undefined, note: words, ...fallBack(row, plan.step) });
  },
};

/** Where a failed step leaves the player: the builds that never came, or the model's pick that never did, send them back to the concept; anything else stays where it was. */
function fallBack(row: CreationRow, step: CreationStep): Partial<CreationRow> {
  if (step === "offer" && row.offer === undefined) return { step: "concept" };
  if (step === "pick" && row.chosen === undefined) return { step: "concept" };
  return {};
}
