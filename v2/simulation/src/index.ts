import { TimeDuration, type Identity } from "spacetimedb";
import { SenderError, t, type ProcedureCtx, type ReducerCtx } from "spacetimedb/server";
import { HEADERS } from "../../shared/protocol/ai.ts";
import { refusal } from "../../shared/protocol/refusals.ts";
import { isAdmin, servicePing as servicePingBody } from "./access.ts";
import { NOT_CONFIGURED, outcomeOf, type AiOutcome, type AiResponse, type Claim } from "./ai-call.ts";
import { Refused, type Schema, type TxCtx } from "./context.ts";
import { installCampaignReducer } from "./install.ts";
import { claimJob, dispatchWaitingReducer, failJob, finishJob, reapJobs as reapJobsBody } from "./jobs.ts";
import { initDatabase, markOnline } from "./lifecycle.ts";
import { joinGameReducer } from "./moves/join-game.ts";
import { newGameReducer } from "./moves/new-game.ts";
import { retryTurnReducer } from "./moves/retry-turn.ts";
import { sayReducer } from "./moves/say.ts";
import spacetimedb, { jobDispatch, NameView, reaper, SeatView } from "./schema.ts";
import { streamReplyReducer } from "./stream.ts";
import { myNamesView, mySeatView } from "./views.ts";

/**
 * The module's entry: every reducer, procedure, view and lifecycle hook, registered (v0-design
 * §3.3), and the few adapters that need SpacetimeDB at run time (txOf, asReducer, the AI service's
 * HTTP). Each body is a plain function over TxCtx in another file, so the memory host runs the same
 * code. The export names are the wire's, in snake_case (newGame is new_game): the client's bindings
 * are generated from them.
 */

export { default } from "./schema.ts";

// Lifecycle: the publisher is the owner; a seated player is online while connected.
export const init = spacetimedb.init(ctx => asReducer(ctx, tx => initDatabase(tx, ctx.sender)));
export const onConnect = spacetimedb.clientConnected(ctx => asReducer(ctx, tx => markOnline(tx, ctx.sender, true)));
export const onDisconnect = spacetimedb.clientDisconnected(ctx => asReducer(ctx, tx => markOnline(tx, ctx.sender, false)));

// The client's moves.
export const newGame = spacetimedb.reducer({ campaign: t.string(), name: t.string(), concept: t.string(), build: t.string() }, (ctx, args) => asReducer(ctx, tx => newGameReducer(tx, ctx.sender, args)));
export const joinGame = spacetimedb.reducer({ game: t.u64() }, (ctx, args) => asReducer(ctx, tx => joinGameReducer(tx, ctx.sender, args)));
export const say = spacetimedb.reducer({ text: t.string() }, (ctx, args) => asReducer(ctx, tx => sayReducer(tx, ctx.sender, args)));
export const retryTurn = spacetimedb.reducer({ turn: t.u64() }, (ctx, args) => asReducer(ctx, tx => retryTurnReducer(tx, ctx.sender, args)));

// The AI service's: the reply as it's written, and proof its token reaches the module as itself.
export const streamReply = spacetimedb.reducer(
  { turnId: t.u64(), attempt: t.u32(), seq: t.u32(), speaker: t.string(), text: t.string(), markup: t.option(t.string()), done: t.bool() },
  (ctx, args) => asReducer(ctx, tx => streamReplyReducer(tx, ctx.sender, args)),
);
export const servicePing = spacetimedb.reducer(ctx => asReducer(ctx, tx => servicePingBody(tx, ctx.sender)));

// The owner's: a campaign's structure, whether the module reaches the AI service, and the waiting thinks sent now that it's back.
export const installCampaign = spacetimedb.reducer(
  { id: t.string(), campaign: t.string(), scenes: t.string(), places: t.string(), builds: t.string(), looks: t.string() },
  (ctx, args) => asReducer(ctx, tx => installCampaignReducer(tx, ctx.sender, args)),
);
export const pingAi = spacetimedb.procedure(t.string(), ctx => pingAiBody(ctx));
export const dispatchWaiting = spacetimedb.reducer(ctx => asReducer(ctx, tx => dispatchWaitingReducer(tx, ctx.sender)));

// The job loop (§3.5): one think per dispatch (claim, POST with nothing locked, commit), and the reaper.
export const runJob = spacetimedb.procedure({ onSchedule: jobDispatch }, { arg: jobDispatch.rowType }, t.unit(), (ctx, { arg }) => {
  if (!fromScheduler(ctx)) return {};
  const claim = ctx.withTx(tx => claimJob(txOf(tx), arg.jobId));
  if (!claim) return {};

  const outcome = postToAi(ctx, claim);

  commitOrFail(ctx, claim, outcome);
  return {};
});
export const reapJobs = spacetimedb.reducer({ onSchedule: reaper }, { arg: reaper.rowType }, ctx => {
  if (fromScheduler(ctx)) asReducer(ctx, reapJobsBody);
});

// The views: the caller's seat, and the names they know the cast by.
export const mySeat = spacetimedb.view({ name: "my_seat", public: true }, t.option(SeatView), ctx => mySeatView(ctx));
export const myNames = spacetimedb.view({ name: "my_names", public: true }, t.array(NameView), ctx => myNamesView(ctx));

// ---------------------------------------------------------------------------------------------
// The adapters.

/** A body's TxCtx from a reducer's context, or a procedure's transaction. */
function txOf(ctx: ReducerCtx<Schema>): TxCtx {
  return {
    db: ctx.db,
    now: ctx.timestamp,
    env: ctx.env,
    database: () => ctx.databaseIdentity.toHexString(),
    uuid: () => ctx.newUuidV4().toString(),
    seed: () => ctx.random.integerInRange(0, 999_999_999),
    log: line => console.info(line),
  };
}

/** Runs a body as a reducer: a refusal reaches the caller as a SenderError carrying it as JSON; anything else thrown is a bug (a panic). */
function asReducer(ctx: ReducerCtx<Schema>, body: (tx: TxCtx) => void): void {
  try {
    body(txOf(ctx));
  } catch (e) {
    throw e instanceof Refused ? new SenderError(JSON.stringify(e.refusal)) : e;
  }
}

/** Scheduled functions run as the database; the owner could call them over HTTP otherwise. */
const fromScheduler = (ctx: { sender: Identity; databaseIdentity: Identity }) => ctx.sender.isEqual(ctx.databaseIdentity);

/** A claimed think's POST to the AI service, nothing locked: what came back, never a throw. */
function postToAi(ctx: ProcedureCtx<Schema>, claim: Claim): AiOutcome {
  if (!ctx.env.AI_URL) return NOT_CONFIGURED;
  return outcomeOf(fetchAi(ctx, ctx.env.AI_URL + claim.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.env.AI_TOKEN ?? ""}`,
      "content-type": "application/json",
      [HEADERS.idempotencyKey]: claim.key,
      [HEADERS.attempt]: String(claim.attempt),
    },
    body: claim.request,
    timeout: TimeDuration.fromMillis(claim.timeoutMs),
  }));
}

/** The answer committed; or, when the commit throws (a bug), the turn failed with why, so a bug fails the turn rather than looping. */
function commitOrFail(ctx: ProcedureCtx<Schema>, claim: Claim, outcome: AiOutcome): void {
  try {
    ctx.withTx(tx => finishJob(txOf(tx), claim, outcome));
  } catch (e) {
    ctx.withTx(tx => failJob(txOf(tx), claim, `the commit failed: ${String(e)}`));
  }
}

/**
 * ping_ai, for the owner: GET the AI service's /v1/health with the bearer. "200 in 3 ms: {…}", or
 * "failed in 5001 ms: <the error>", or why it wasn't sent. Never throws: a procedure's errors reach
 * its caller only as text.
 */
function pingAiBody(ctx: ProcedureCtx<Schema>): string {
  if (!ctx.withTx(tx => isAdmin(txOf(tx), ctx.sender))) return JSON.stringify(refusal("not_admin", { what: "ping the AI service" }));
  if (!ctx.env.AI_URL) return "not configured: AI_URL is empty";

  const sent = ctx.timestamp;
  const answer = fetchAi(ctx, `${ctx.env.AI_URL}/v1/health`, { headers: { authorization: `Bearer ${ctx.env.AI_TOKEN ?? ""}` }, timeout: TimeDuration.fromMillis(5_000) });
  const ms = msSince(ctx, sent);

  return "error" in answer ? `failed in ${ms} ms: ${answer.error}` : `${answer.status} in ${ms} ms: ${answer.body}`;
}

/** SpacetimeDB's fetch, its throw (refused, reset, DNS, timed out) caught as the error's text. */
function fetchAi(ctx: ProcedureCtx<Schema>, url: string, init: Parameters<ProcedureCtx<Schema>["http"]["fetch"]>[1]): AiResponse {
  try {
    const res = ctx.http.fetch(url, init);
    return { status: res.status, body: res.text(), replayed: res.headers.get(HEADERS.replayed) === "1" };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Milliseconds since a time, by a transaction's clock: the module reads no other. */
function msSince(ctx: ProcedureCtx<Schema>, then: ReducerCtx<Schema>["timestamp"]): number {
  const now = ctx.withTx(tx => tx.timestamp);
  return Number((now.microsSinceUnixEpoch - then.microsSinceUnixEpoch) / 1000n);
}
