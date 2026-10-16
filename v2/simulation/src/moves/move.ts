import type { BackstoriesRequest, CharactersRequest, DecideRequest, Endpoint, OpenRequest, ReplyRequest, SettleRequest, Usage } from "../../../shared/protocol/ai.ts";
import type { Refusal } from "../../../shared/protocol/refusals.ts";
import type { Actor, TxCtx } from "../context.ts";

/**
 * A move, in the design's four phases (content-server §3, v0-design §4.1), with one change: `think`
 * runs inside the transaction that queues the job, reading the rows, so the request is exactly the
 * state the commit's revision check compares against, and the stored request can be POSTed again
 * after any crash. Plain functions over TxCtx: the same move runs in SpacetimeDB and on the memory
 * host.
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
  /** Whose job it is, as the job loop sees it: absent, a turn's (V0's), the scene's lease and the turn's row. */
  owner?: JobOwner<Plan>;
}

/**
 * What the job loop asks of whoever a move's job is for (v1-design §3.5): a turn's (V0's, the
 * default) or a creation's, which has no scene and no turn. The loop's claim, deadline, backoff,
 * reaper and give-up are the same for both.
 */
export interface JobOwner<Plan> {
  /** Is the answer still wanted? A turn's: the scene's lease is this turn's, and the scene isn't over. A creation's: its row is still at plan.rev. */
  wanted(tx: TxCtx, plan: Plan): boolean;
  /** The note while it waits to try again ("The GM has lost the thread for a moment…"), or undefined when the answer came. */
  waiting(tx: TxCtx, plan: Plan, note: string | undefined): void;
  /** An answer's model calls and cost, added to the owner's. */
  charge(tx: TxCtx, plan: Plan, usage: Usage): void;
  /** The job failed for good, in the player's words. A turn's fails, its draft deleted, the lease kept for retry_turn. */
  failed(tx: TxCtx, plan: Plan, words: string): void;
}

export type Next<Plan> = { done: true } | { done: false; plan: Plan };

/** A think's request: where it goes, its idempotency key, how long to wait, and the body. */
export interface AiCall { endpoint: Endpoint; key: string; timeoutMs: number; request: OpenRequest | DecideRequest | ReplyRequest | SettleRequest | CharactersRequest | BackstoriesRequest }
