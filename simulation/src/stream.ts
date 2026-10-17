import type { Identity } from "spacetimedb";
import { refusal } from "../../shared/protocol/refusals.ts";
import { isService } from "./access.ts";
import { Refused, type TxCtx } from "./context.ts";
import { updateTurn, type RowOf, type TurnRow } from "./rows.ts";

/**
 * stream_reply (v0-design §3.3, §5.8): the AI service's reply as it's written, into the turn's
 * draft, which every client watching the scene sees grow. Only the AI service may post. A post is
 * taken only while its turn is replying and only if it comes after the draft's (attempt, then seq):
 * a new attempt replaces the text (a re-dispatched reply starts again), and a stale post is dropped
 * without a word, since the service posts and moves on. The turn's note that the reply was lost goes
 * as soon as it's visibly being written again: at a new attempt's first words, or at any words once
 * the think is running again (the AI service joins a re-dispatch to the request still in flight,
 * whose words go on under the first attempt's number). While the think waits to try again, a lost
 * attempt's late words leave it.
 */

export interface StreamArgs { turnId: bigint; attempt: number; seq: number; speaker: string; text: string; markup?: string; done: boolean }

export function streamReplyReducer(tx: TxCtx, sender: Identity, post: StreamArgs): void {
  if (!isService(tx.env, sender)) throw new Refused(refusal("not_service"));

  const turn = tx.db.turn.id.find(post.turnId);
  if (!turn || turn.phase !== "replying") return;
  const draft = tx.db.replyDraft.turnId.find(turn.id);
  if (draft && !isLater(post, draft)) return;

  writeDraft(tx, turn, draft ?? undefined, post);
  if (turn.firstTextAt === undefined && post.text) updateTurn(tx, turn.id, { firstTextAt: tx.now });
  if (turn.note && (!draft || post.attempt > draft.attempt || runningAgain(tx, turn.id))) updateTurn(tx, turn.id, { note: undefined });
}

/** The turn's think is running: with the note up, that's a re-dispatch at work on the reply. */
const runningAgain = (tx: TxCtx, turnId: bigint) => [...tx.db.job.state.filter("running")].some(j => j.turnId === turnId);

/** After the draft's: a later attempt, or a later post in the same one. */
const isLater = (post: StreamArgs, draft: RowOf<"replyDraft">) => post.attempt > draft.attempt || (post.attempt === draft.attempt && post.seq > draft.seq);

function writeDraft(tx: TxCtx, turn: TurnRow, draft: RowOf<"replyDraft"> | undefined, post: StreamArgs): void {
  const row = { turnId: turn.id, sceneId: turn.sceneId, speaker: post.speaker, text: post.text, markup: post.markup, attempt: post.attempt, seq: post.seq, done: post.done };
  if (draft) tx.db.replyDraft.turnId.update(row);
  else tx.db.replyDraft.insert(row);
}
