import type {
  BackstoriesRequest, BoundaryRequest, CharactersRequest, Endpoint, LooksRequest, OpenRequest, ReactionsRequest, RememberRequest, ReplyRequest,
  SettleRequest, SuggestRequest, Usage,
} from "../../../shared/protocol/ai.ts";
import type { Refusal } from "../../../shared/protocol/refusals.ts";
import type { Actor, TxCtx } from "../context.ts";

/**
 * A move, in the design's four phases (content-server §3, v0-design §4.1), with one change: `think`
 * runs inside the transaction that queues the job, reading the rows, so the request is exactly the
 * state the commit's revision check compares against, and the stored request can be POSTed again
 * after any crash. Plain functions over TxCtx: the same move runs in SpacetimeDB and on the memory
 * host.
 *
 * Whose job a move's think is, the job loop asks its owner (v1-design §3.5): absent, a turn's. A job
 * queued beside a turn's own steps (the lines suggested after it:
 * v5-design §3.4) changes how its turn treats it with the last five, each optional: without them a
 * turn's job is treated as V0 treats every one.
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
  /** Whose job it is, as the job loop sees it: absent, a turn's (V0's), the scene's lease and the turn's row, as the five below refine it. */
  owner?: JobOwner<Plan>;
  /** A turn's job: run_job's revision check on an answer. Default: the scene's lease is this turn's and the scene hasn't ended. */
  applies?(tx: TxCtx, plan: Plan): boolean;
  /** A turn's job that can't finish: a fatal status, a commit that threw, or failing for giveUpMs. Default: the turn fails, the job kept for retry_turn. */
  giveUp?(tx: TxCtx, plan: Plan, why: string): void;
  /** How long a failing job keeps trying. Default: 10 minutes. */
  giveUpMs?: number;
  /** A turn's job in the background (the lines): its retries leave turn.note alone (unless the turn waits on it: waitedOn), and it never fails the turn. */
  background?: boolean;
  /** A background job the turn is waiting on now: its retries say so on the turn, as its own steps' do. (None since M2 took the notes out: the turn never waits on its lines.) */
  waitedOn?(tx: TxCtx, plan: Plan): boolean;
}

/**
 * What the job loop asks of whoever a move's job is for (v1-design §3.5): a turn's (V0's, the
 * default, with a background job's differences: v5-design §3.4) or a creation's, which has no scene
 * and no turn. The loop's claim, deadline, backoff and reaper are the same for both.
 */
export interface JobOwner<Plan> {
  /** Is the answer still wanted? A turn's: the scene's lease is this turn's, and the scene isn't over (or as the move's applies says). A creation's: its row is still at plan.rev. */
  wanted(tx: TxCtx, plan: Plan): boolean;
  /** The note while it waits to try again ("The GM has lost the thread for a moment…"), or undefined when the answer came. */
  waiting(tx: TxCtx, plan: Plan, note: string | undefined): void;
  /** An answer's model calls and cost, added to the owner's. */
  charge(tx: TxCtx, plan: Plan, usage: Usage): void;
  /** The job failed for good, in the player's words. A turn's own step fails the turn, its draft deleted, the lease kept for retry_turn; a background job gives up as its move says. */
  failed(tx: TxCtx, plan: Plan, words: string): void;
}

export type Next<Plan> = { done: true } | { done: false; plan: Plan };

/** A think's request: where it goes, its idempotency key, how long to wait, and the body. */
export interface AiCall {
  endpoint: Endpoint;
  key: string;
  timeoutMs: number;
  request:
    | OpenRequest | ReactionsRequest | ReplyRequest | SettleRequest | SuggestRequest | RememberRequest
    | BoundaryRequest | LooksRequest
    | CharactersRequest | BackstoriesRequest;
}
