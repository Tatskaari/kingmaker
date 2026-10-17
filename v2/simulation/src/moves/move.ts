import type { DecideRequest, Endpoint, NotesRequest, OpenRequest, ReplyRequest, SettleRequest, SuggestRequest } from "../../../shared/protocol/ai.ts";
import type { Refusal } from "../../../shared/protocol/refusals.ts";
import type { Actor, TxCtx } from "../context.ts";

/**
 * A move, in the design's four phases (content-server §3, v0-design §4.1), with one change: `think`
 * runs inside the transaction that queues the job, reading the rows, so the request is exactly the
 * state the commit's revision check compares against, and the stored request can be POSTed again
 * after any crash. Plain functions over TxCtx: the same move runs in SpacetimeDB and on the memory
 * host.
 *
 * A job queued beside a turn's own steps (the notes on a reply's marks, the lines suggested after
 * it: v5-design §3.4) changes how the job loop treats it with the last five, each optional: without
 * them a job is treated as V0 treats every one.
 */
export interface Move<Args, Plan> {
  readonly name: string;
  /** May this actor make this move now? Runs in the reducer only in V0 (the client mirrors say's in view.mayType). */
  check?(tx: TxCtx, actor: Actor, args: Args): Refusal | undefined;
  /** In the reducer's transaction: record the move, roll, change the world; done, or a plan to think about. */
  resolve(tx: TxCtx, actor: Actor, args: Args): Next<Plan>;
  /** In the same transaction as the resolve or commit that made the plan: the request to POST next. */
  think?(tx: TxCtx, plan: Plan): AiCall;
  /** In run_job's withTx, after the revision check: apply the answer; done, or the next plan. */
  commit?(tx: TxCtx, plan: Plan, answer: unknown): Next<Plan>;
  /** run_job's revision check on an answer. Default: the scene's lease is this turn's and the scene hasn't ended. */
  applies?(tx: TxCtx, plan: Plan): boolean;
  /** A job that can't finish: a fatal status, a commit that threw, or failing for giveUpMs. Default: the turn fails (failJob). */
  giveUp?(tx: TxCtx, plan: Plan, why: string): void;
  /** How long a failing job keeps trying. Default: 10 minutes. */
  giveUpMs?: number;
  /** A background job (the notes, the lines): its retries leave turn.note alone (unless the turn waits on it: waitedOn), and it never fails the turn. */
  background?: boolean;
  /** A background job the turn is waiting on now (its notes, once all else is in): its retries say so on the turn, as its own steps' do. */
  waitedOn?(tx: TxCtx, plan: Plan): boolean;
}

export type Next<Plan> = { done: true } | { done: false; plan: Plan };

/** A think's request: where it goes, its idempotency key, how long to wait, and the body. */
export interface AiCall {
  endpoint: Endpoint;
  key: string;
  timeoutMs: number;
  request: OpenRequest | DecideRequest | ReplyRequest | SettleRequest | NotesRequest | SuggestRequest;
}
