import type { Mark } from "../../../shared/markup.ts";
import type { NotesResponse } from "../../../shared/protocol/ai.ts";
import { idOf, idText } from "../../../shared/protocol/keys.ts";
import type { TxCtx } from "../context.ts";
import { notesCall } from "../gm/requests.ts";
import { queueThink } from "../jobs.ts";
import { turnRow, updateTurn } from "../rows.ts";
import { entryAt, markupOf, putMarks, type Written } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import type { Move } from "./move.ts";
import type { NotesPlan } from "./plans.ts";

/**
 * The notes on a reply's marks (v5-design §3.4, §3.5; the prototype's annotate, notes.ts:333-345).
 * The commit that writes a reply with something to note (a spoken line, or a mark the GM made) asks
 * for them; the AI service writes them from what the player knows, placed on the reply's words,
 * linked and carded; they land on the reply's transcript row as its marks. A job in the background:
 * the turn waits for it to end (noting), and nothing else does. One that can't be written leaves the
 * reply with no marks, and the turn ends all the same: after 60 s of an outage, which the turn says
 * it's waiting through once it's noting.
 */
export const notes: Move<void, NotesPlan> = {
  name: "notes",
  background: true,
  giveUpMs: 60_000,

  resolve() {
    throw new Error("notes are asked for by a reply's commit, never made as a move");
  },

  think: (tx, plan) => notesCall(tx, plan),

  /** Always: the notes belong on their row whatever has happened since, and the turn may be waiting for them. */
  applies: () => true,

  /** Once all else is in, the turn waits on its notes alone (noting): through an outage it says so, as on its own steps, until they land or are given up. */
  waitedOn: (tx, plan) => turnRow(tx, idOf(plan.turn)).phase === "noting",

  commit(tx, plan, answer) {
    const marks = (answer as Partial<NotesResponse>).marks;
    if (!Array.isArray(marks)) throw new Error("the answer has no marks");

    if (marks.length) putMarks(tx, entryAt(tx, idOf(plan.scene), plan.seq), marks);
    notesIn(tx, plan, "written", marks);
    return { done: true };
  },

  giveUp(tx, plan) {
    notesIn(tx, plan, "lost", []);
  },
};

/** After a reply is written: its notes asked for, when it has something to note (a spoken line, or a mark the GM made: notes.ts:333), and the turn waits for them. */
export function askForNotes(tx: TxCtx, turnId: bigint, reply: Written): void {
  const speech = markupOf(reply.row)?.speech ?? [];
  if (!speech.length && !reply.drafted.length) return;

  const turn = updateTurn(tx, turnId, { notes: "writing" });
  queueThink(tx, notes, { step: "notes", game: idText(turn.gameId), scene: idText(turn.sceneId), turn: idText(turn.id), n: turn.n, seq: reply.row.seq, drafted: reply.drafted });
}

/** The notes are in (or lost): the turn says so, and ends now if they were all it waited for. */
function notesIn(tx: TxCtx, plan: NotesPlan, state: "written" | "lost", marks: Mark[]): void {
  const turn = updateTurn(tx, idOf(plan.turn), { notes: state });
  tx.log(`[scene ${plan.scene} turn ${plan.n}] notes ${state}${state === "written" ? `: ${marks.length}` : ""} on entry ${plan.seq}`);
  if (turn.phase === "noting") finishTurn(tx, turn.sceneId, turn.id);
}
