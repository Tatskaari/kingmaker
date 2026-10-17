import type { DecideRequest, Endpoint, OpenRequest, ReplyRequest, SettleRequest } from "../../../shared/protocol/ai.ts";
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
}

export type Next<Plan> = { done: true } | { done: false; plan: Plan };

/** A think's request: where it goes, its idempotency key, how long to wait, and the body. */
export interface AiCall { endpoint: Endpoint; key: string; timeoutMs: number; request: OpenRequest | DecideRequest | ReplyRequest | SettleRequest }
