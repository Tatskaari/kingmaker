import type { Identity, Timestamp } from "spacetimedb";
import type { InferSchema, ReducerCtx } from "spacetimedb/server";
import type { Refusal } from "../../shared/protocol/refusals.ts";
import { queueThink, type JobPlan } from "./jobs.ts";
import type { Move } from "./moves/move.ts";
import type spacetimedb from "./schema.ts";

/**
 * What a move's body runs on (v0-design §4.1): the module's own tables and the transaction's time,
 * env and randomness, with nothing of SpacetimeDB's at run time, so the same body runs in the module
 * (index.ts's txOf makes one from a reducer's context) and on the memory host. And how a move is
 * made: checked, resolved, and its think queued in the same transaction.
 */

export type Schema = InferSchema<typeof spacetimedb>;

/** The module's tables, as a transaction has them: tx.db.scene.id.find(…). */
export type Db = ReducerCtx<Schema>["db"];

/** The env set at publish. */
export interface Env { AI_URL?: string; AI_TOKEN?: string; AI_IDENTITY?: string }

export interface TxCtx {
  db: Db;
  /** The transaction's time. */
  now: Timestamp;
  env: Env;
  /** A new UUID (a game's uid). */
  uuid(): string;
  /** A new game's dice seed, 0 to 999,999,999. */
  seed(): number;
  /** A line in the module's log (spacetime logs). */
  log(line: string): void;
}

/** Who is making a move: the caller, and the player their seat holds (none when they have no seat). */
export interface Actor { identity: Identity; id?: bigint }

/** A move refused, in the game's words: thrown in a body, it reaches the caller as a SenderError carrying the refusal as JSON. */
export class Refused extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.text);
    this.refusal = refusal;
  }
}

/** The caller, and the player their seat holds. */
export function actorOf(tx: TxCtx, identity: Identity): Actor {
  const seat = tx.db.seat.identity.find(identity);
  return seat ? { identity, id: seat.playerId } : { identity };
}

/**
 * A move, made (content-server §3): may this actor make it now; then the move itself, recorded in
 * this transaction; then, if it has something to think about, its job queued in the same one, so
 * the request run_job POSTs is exactly the state this transaction leaves.
 */
export function runMove<A, P extends JobPlan>(tx: TxCtx, move: Move<A, P>, actor: Actor, args: A): void {
  const refusal = move.check?.(tx, actor, args);
  if (refusal) throw new Refused(refusal);

  const next = move.resolve(tx, actor, args);

  if (!next.done) queueThink(tx, move, next.plan);
}
