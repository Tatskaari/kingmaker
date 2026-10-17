import { ScheduleAt, Timestamp, type Identity } from "spacetimedb";
import type { Endpoint, Usage } from "../../shared/protocol/ai.ts";
import { idOf, type CreationStep, type Step } from "../../shared/protocol/keys.ts";
import { refusal } from "../../shared/protocol/refusals.ts";
import { isAdmin } from "./access.ts";
import type { AiOutcome, Claim } from "./ai-call.ts";
import { Refused, type TxCtx } from "./context.ts";
import type { JobOwner, Move } from "./moves/move.ts";
import { moveNamed } from "./moves/registry.ts";
import { turnRow, updateTurn, type JobRow } from "./rows.ts";

/**
 * The job loop (v0-design §3.5, v1-design §3.5, v5-design §3.4). One `job` row per move in flight
 * (for a turn, one a turn and move) holds its plan and the request to POST next, keyed by the step's
 * idempotency key; each `job_dispatch` row runs run_job once (claim, POST with nothing locked,
 * commit). A POST that can be tried again leaves the job waiting, and the reaper dispatches it at its
 * time; one that can't fails it. A job whose procedure died (the server stopped mid-think) is
 * dispatched again after its deadline. Whose job it is (a turn's, or a creation's) is its move's
 * owner: whether the answer is still wanted, where the note goes while it waits, what it cost, and
 * what failing means. Every function here is a pure function of the rows, the claim and the answer:
 * withTx may run one twice.
 *
 * A job beside a turn's own steps (the lines: v5-design §3.4) runs on the same loop, and
 * its move says how it differs: whether an answer still applies, what giving up on it does and when,
 * and that it's in the background, so it never fails the turn, and its retries say nothing on it
 * unless the turn is waiting on it alone.
 */

/**
 * What every move's plan carries for its job row: the step it thinks next, and, for a turn's, the
 * game, scene and turn (ids as strings). A creation's plan has none of the three: it names its
 * creation instead (creation/steps.ts).
 */
export interface JobPlan { step: Step | CreationStep; game?: string; scene?: string; turn?: string }

/** Seconds before each try again: after the first failure, the second, …; then every 15 s. */
const RETRY_SECONDS = [1, 2, 4, 8, 15];
/** A running job's deadline is its POST's timeout and this: past it, the procedure has died. */
const GRACE_MS = 10_000;
/** A queued job with no dispatch for this long (its procedure died before claiming it) gets another. */
const FORGOTTEN_MS = 10_000;
/** Failing for this long, a job fails rather than trying on (unless its move says otherwise). */
const GIVE_UP_MS = 10 * 60_000;
/** The note while a job waits to try again. */
export const LOST_THREAD = "The GM has lost the thread for a moment: trying again.";

/**
 * A new move's think: its job row (the plan, and the request built from the rows this transaction
 * sees) and a dispatch now. A turn's are one row a turn and move: one the move already has for the
 * turn is written over, and an answer to what it held is dropped as stale.
 */
export function queueThink<P extends JobPlan>(tx: TxCtx, move: Move<unknown, P>, plan: P): void {
  const think = { ...thinkOf(tx, move, plan), ...freshState(tx) };
  const old = plan.turn === undefined ? undefined : jobOf(tx, idOf(plan.turn), move.name);
  const job = old ? tx.db.job.id.update({ ...old, ...think }) : tx.db.job.insert({ id: 0n, ...think });
  dispatch(tx, job.id);
}

/** run_job's first transaction: the job is this dispatch's to run, if it's still queued (else the dispatch is stale). */
export function claimJob(tx: TxCtx, jobId: bigint): Claim | undefined {
  const job = tx.db.job.id.find(jobId);
  if (!job || job.state !== "queued") return undefined;

  const attempt = job.attempts + 1;
  tx.db.job.id.update({ ...job, state: "running", attempts: attempt, deadline: after(tx.now, job.timeoutMs + GRACE_MS), updatedAt: tx.now });
  return { jobId, key: job.key, endpoint: job.endpoint as Endpoint, request: job.request, timeoutMs: job.timeoutMs, attempt };
}

/**
 * run_job's last transaction: what the POST came to. Dropped when the job has moved on since the
 * claim (the reaper dispatched it again), or when its owner no longer wants it (the scene no longer
 * waits on the turn; the player has moved the creation on); a retry waits; an answer is committed,
 * and the move goes on to its next think or ends; anything else can't finish.
 */
export function finishJob(tx: TxCtx, claim: Claim, outcome: AiOutcome): void {
  const job = claimedJob(tx, claim);
  if (!job) return tx.log(`${label(claim)} dropped: the job has moved on since this dispatch`);
  if (!wanted(tx, job)) return dropJob(tx, job, label(claim));

  if (outcome.kind === "retry") return waitToRetry(tx, job, claim, outcome.reason);
  if (outcome.kind === "fatal") return cantFinish(tx, job, label(claim), outcome.reason, outcome.words);
  commitAnswer(tx, job, claim, outcome);
}

/** run_job's last word when a commit throws: the job can't finish (a turn's own step fails the turn, the lease kept, so the scene waits for retry_turn). */
export function failJob(tx: TxCtx, claim: Claim, reason: string): void {
  const job = tx.db.job.id.find(claim.jobId);
  if (!job || job.key !== claim.key || job.state === "failed") return;
  cantFinish(tx, job, label(claim), reason);
}

/** reap_jobs, every 2 s: what has failed too long fails; what waited long enough, overran its deadline, or lost its dispatch, is dispatched. What nobody wants any more goes. */
export function reapJobs(tx: TxCtx): void {
  giveUpOnLongFailures(tx);
  retryWaiting(tx);
  redispatchOverdue(tx);
  redispatchForgotten(tx);
}

/**
 * dispatch_waiting, the owner's: every waiting job dispatched now, not at its time. The dev host
 * calls it once it has started the AI service again (s, r, f, n), so a turn the backoff would hold
 * for up to 15 s more goes on at once.
 */
export function dispatchWaitingReducer(tx: TxCtx, sender: Identity): void {
  if (!isAdmin(tx, sender)) throw new Refused(refusal("not_admin", { what: "dispatch the waiting thinks" }));
  for (const job of jobsIn(tx, "waiting")) if (!dropUnwanted(tx, job)) dispatchAgain(tx, job, "[dispatch_waiting]");
}

/**
 * A host's start, when no run_job outlives a restart (the page's: browser-design §4.2): every job
 * that was running is dispatched again now, rather than once its deadline has passed (up to three
 * minutes on). Its POST is the same step's, with the same idempotency key, so an answer the AI
 * service kept is replayed. One nobody wants any more goes instead.
 */
export function requeueRunning(tx: TxCtx): void {
  for (const job of jobsIn(tx, "running")) if (!dropUnwanted(tx, job, "[restart]")) dispatchAgain(tx, job, "[restart]");
}

/** retry_turn's: a failed job queued again from its first attempt, with a dispatch. */
export function retryJob(tx: TxCtx, job: JobRow): void {
  tx.db.job.id.update({ ...job, ...freshState(tx) });
  dispatch(tx, job.id);
  tx.log(`[job ${job.id} ${job.key}] queued again by retry_turn`);
}

/** The failed job of a turn's own steps, if it has one: a background job is never the turn's to retry. */
export function failedJobOf(tx: TxCtx, turnId: bigint): JobRow | undefined {
  return [...tx.db.job.state.filter("failed")].find(j => j.turnId === turnId && !moveNamed(j.move).background);
}

// ---------------------------------------------------------------------------------------------
// A turn's jobs (V0's, the default owner): the scene's lease is the guard, and the turn's row has the
// note, the usage and the failure. A job in the background (v5-design §3.4) is guarded by its move's
// applies, says it waits only while the turn waits on it, and gives up as its move says, never
// failing the turn.

function turnOwner(move: Move<unknown, JobPlan>): JobOwner<JobPlan> {
  return {
    wanted(tx, plan) {
      if (move.applies) return move.applies(tx, plan);
      const scene = tx.db.scene.id.find(idOf(needs(plan.scene, "scene")));
      return !!scene && scene.turnId === idOf(needs(plan.turn, "turn")) && scene.status !== "ended";
    },
    /** A turn's own step says so on the turn, and its answer clears it; a background job only says so while the turn waits on it, and its answer leaves the note alone (its commit clears it when the turn was waiting on it). */
    waiting(tx, plan, note) {
      if (move.background && (note === undefined || !move.waitedOn?.(tx, plan))) return;
      updateTurn(tx, idOf(needs(plan.turn, "turn")), { note });
    },
    /** Every answer's usage goes on its turn, the lines' too. */
    charge(tx, plan, usage) {
      const turn = turnRow(tx, idOf(needs(plan.turn, "turn")));
      tx.db.turn.id.update({ ...turn, calls: turn.calls + usage.calls, costMicros: turn.costMicros + micros(usage.costUsd) });
    },
    /** The move gives up on it (a background job's); else the turn fails, its draft deleted, the lease kept: the scene waits for retry_turn. */
    failed(tx, plan, words) {
      if (move.giveUp) return move.giveUp(tx, plan, words);
      const turnId = idOf(needs(plan.turn, "turn"));
      updateTurn(tx, turnId, { phase: "failed", error: words, note: undefined });
      tx.db.replyDraft.turnId.delete(turnId);
    },
  };
}

/** A job's move, its owner, and its plan. */
function ownerOf(job: JobRow): { move: Move<unknown, JobPlan>; owner: JobOwner<JobPlan>; plan: JobPlan } {
  const move = moveNamed(job.move);
  return { move, owner: move.owner ?? turnOwner(move), plan: JSON.parse(job.plan) as JobPlan };
}

const wanted = (tx: TxCtx, job: JobRow) => {
  const { owner, plan } = ownerOf(job);
  return owner.wanted(tx, plan);
};

// ---------------------------------------------------------------------------------------------
// finishJob's parts.

/** The job as the claim left it: still running, on this attempt. */
function claimedJob(tx: TxCtx, claim: Claim): JobRow | undefined {
  const job = tx.db.job.id.find(claim.jobId);
  return job && job.state === "running" && job.attempts === claim.attempt && job.key === claim.key ? job : undefined;
}

/** The answer applied by its move, its usage charged to the owner; then the move's next think, or its end. */
function commitAnswer(tx: TxCtx, job: JobRow, claim: Claim, answer: Extract<AiOutcome, { kind: "answer" }>): void {
  const { move, owner, plan } = ownerOf(job);
  owner.charge(tx, plan, usageOf(answer.answer));
  owner.waiting(tx, plan, undefined);

  const next = move.commit!(tx, plan, answer.answer);

  if (next.done) tx.db.job.id.delete(job.id);
  else requeue(tx, job.id, move, next.plan);
  tx.log(`${label(claim)} 200 in ${msBetween(job.updatedAt, tx.now)} ms: committed${answer.replayed ? " (an answer the AI service had kept)" : ""}${next.done ? "" : `, ${next.plan.step} next`}`);
}

/** The move's next think, in the same job row (one per move in flight): its new key, request and plan. */
function requeue(tx: TxCtx, jobId: bigint, move: Move<unknown, JobPlan>, plan: JobPlan): void {
  const job = tx.db.job.id.find(jobId)!;
  tx.db.job.id.update({ ...job, ...thinkOf(tx, move, plan), ...freshState(tx) });
  dispatch(tx, jobId);
}

/** An answer's model calls and cost, read defensively: the service's JSON may leave them out. */
function usageOf(answer: unknown): Usage {
  const usage = (answer as { usage?: { calls?: unknown; costUsd?: unknown } } | null)?.usage;
  const calls = typeof usage?.calls === "number" ? Math.max(0, Math.round(usage.calls)) : 0;
  const costUsd = typeof usage?.costUsd === "number" ? Math.max(0, usage.costUsd) : 0;
  return { calls, costUsd, byOperation: {} };
}

/** Its owner no longer waits on it (the scene ended, another turn holds the lease, the creation moved on): the move stops, keeping what was committed. */
function dropJob(tx: TxCtx, job: JobRow, who: string): void {
  tx.db.job.id.delete(job.id);
  tx.log(`${who} dropped: ${job.turnId !== undefined ? `scene ${job.sceneId} no longer waits on turn ${job.turnId}` : job.sceneId !== undefined ? `scene ${job.sceneId}'s boundary has been crossed` : "its creation has moved on"}`);
}

/** Try again later: waiting until retryAt (1, 2, 4, 8, then every 15 s), and the owner says so (a turn's job in the background only while the turn waits on it). */
function waitToRetry(tx: TxCtx, job: JobRow, claim: Claim, reason: string): void {
  const seconds = RETRY_SECONDS[Math.min(claim.attempt, RETRY_SECONDS.length) - 1]!;
  const { owner, plan } = ownerOf(job);
  tx.db.job.id.update({ ...job, state: "waiting", retryAt: after(tx.now, seconds * 1000), deadline: undefined, failingSince: job.failingSince ?? tx.now, error: reason, updatedAt: tx.now });
  owner.waiting(tx, plan, LOST_THREAD);
  tx.log(`${label(claim)} ${reason}: waiting, retry in ${seconds} s`);
}

/**
 * A job that can't finish: a status trying again won't mend, a commit that threw, or failing too
 * long. Its owner fails with it, in the player's words: the AI service's own when it gave them (over
 * its daily budget), else that the GM couldn't answer. A turn's own step is kept, failed, for
 * retry_turn; any other job is done with: a background one's move gives up on it, and a creation's
 * next move asks again.
 */
function cantFinish(tx: TxCtx, job: JobRow, who: string, reason: string, words = `The GM couldn't answer: ${shortly(reason)}`): void {
  const { move, owner, plan } = ownerOf(job);
  const kept = job.turnId !== undefined && !move.giveUp;
  if (kept) tx.db.job.id.update({ ...job, state: "failed", error: reason, deadline: undefined, retryAt: undefined, updatedAt: tx.now });
  else tx.db.job.id.delete(job.id);
  owner.failed(tx, plan, words);
  tx.log(`${who} ${move.giveUp ? "gave up" : "failed"}: ${reason}`);
}

// ---------------------------------------------------------------------------------------------
// The reaper's parts.

function giveUpOnLongFailures(tx: TxCtx): void {
  for (const job of jobsIn(tx, "waiting", "running")) {
    const limit = moveNamed(job.move).giveUpMs ?? GIVE_UP_MS;
    if (!job.failingSince || msBetween(job.failingSince, tx.now) < limit) continue;
    const who = `[reaper] job ${job.id} ${job.key}`;
    if (!wanted(tx, job)) dropJob(tx, job, who);
    else cantFinish(tx, job, who, `no answer for ${spokenMs(limit)} (last: ${job.error ?? "none"})`);
  }
}

function retryWaiting(tx: TxCtx): void {
  for (const job of jobsIn(tx, "waiting")) {
    if (job.retryAt && job.retryAt.microsSinceUnixEpoch > tx.now.microsSinceUnixEpoch) continue;
    if (dropUnwanted(tx, job)) continue;
    dispatchAgain(tx, job, "[reaper]");
  }
}

/** A waiting job (or a running one whose run_job is gone) queued, with a dispatch: its next attempt. */
function dispatchAgain(tx: TxCtx, job: JobRow, who: string): void {
  tx.db.job.id.update({ ...job, state: "queued", retryAt: undefined, deadline: undefined, updatedAt: tx.now });
  dispatch(tx, job.id);
  tx.log(`${who} job ${job.id} ${job.key} dispatched again (attempt ${job.attempts + 1})`);
}

/** A running job past its deadline: its procedure died with the server, or its POST never came back. */
function redispatchOverdue(tx: TxCtx): void {
  for (const job of jobsIn(tx, "running")) {
    if (!job.deadline || job.deadline.microsSinceUnixEpoch > tx.now.microsSinceUnixEpoch) continue;
    if (dropUnwanted(tx, job)) continue;
    const { owner, plan } = ownerOf(job);
    tx.db.job.id.update({ ...job, state: "queued", deadline: undefined, failingSince: job.failingSince ?? tx.now, error: "no answer by its deadline", updatedAt: tx.now });
    owner.waiting(tx, plan, LOST_THREAD);
    dispatch(tx, job.id);
    tx.log(`[reaper] job ${job.id} ${job.key} re-dispatched after its deadline`);
  }
}

/** A queued job whose dispatch was consumed by a procedure that died before claiming it. */
function redispatchForgotten(tx: TxCtx): void {
  const dispatched = new Set([...tx.db.jobDispatch.iter()].map(d => d.jobId));
  for (const job of jobsIn(tx, "queued")) {
    if (dispatched.has(job.id) || msBetween(job.updatedAt, tx.now) < FORGOTTEN_MS) continue;
    if (dropUnwanted(tx, job)) continue;
    tx.db.job.id.update({ ...job, updatedAt: tx.now });
    dispatch(tx, job.id);
    tx.log(`[reaper] job ${job.id} ${job.key} had no dispatch: dispatched`);
  }
}

/** A job about to be dispatched again that nobody wants any more goes instead: a creation the player has moved on from asks for nothing more. */
function dropUnwanted(tx: TxCtx, job: JobRow, who = "[reaper]"): boolean {
  if (wanted(tx, job)) return false;
  dropJob(tx, job, `${who} job ${job.id} ${job.key}`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// The rows.

/** A think's columns: where it goes, its key, the request built now from the rows, the plan; a turn's game, scene and turn. */
function thinkOf<P extends JobPlan>(tx: TxCtx, move: Move<unknown, P>, plan: P) {
  const call = move.think!(tx, plan);
  return {
    key: call.key, gameId: idIn(plan.game), sceneId: idIn(plan.scene), turnId: idIn(plan.turn), move: move.name, step: plan.step,
    endpoint: call.endpoint, timeoutMs: call.timeoutMs, request: JSON.stringify(call.request), plan: JSON.stringify(plan),
  };
}

/** A job ready for its first attempt. */
const freshState = (tx: TxCtx) => ({ state: "queued", attempts: 0, deadline: undefined, retryAt: undefined, failingSince: undefined, error: undefined, updatedAt: tx.now });

/**
 * The move's job for a turn, if it has one in flight. The table holds only what's in flight (and a
 * turn's failed step), so it's read whole: an option column (a creation's job has no turn) can't
 * take an index.
 */
const jobOf = (tx: TxCtx, turnId: bigint, move: string): JobRow | undefined => [...tx.db.job.iter()].find(j => j.turnId === turnId && j.move === move);

/** run_job for this job, about 3 ms after this transaction commits. */
function dispatch(tx: TxCtx, jobId: bigint): void {
  tx.db.jobDispatch.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(tx.now.microsSinceUnixEpoch), jobId });
}

const jobsIn = (tx: TxCtx, ...states: string[]): JobRow[] => states.flatMap(s => [...tx.db.job.state.filter(s)]);

const after = (t: Timestamp, ms: number) => new Timestamp(t.microsSinceUnixEpoch + BigInt(Math.round(ms)) * 1000n);

const msBetween = (from: Timestamp, to: Timestamp) => Number((to.microsSinceUnixEpoch - from.microsSinceUnixEpoch) / 1000n);

const micros = (usd: number) => BigInt(Math.round(usd * 1_000_000));

const idIn = (id: string | undefined) => (id === undefined ? undefined : idOf(id));

const label = (claim: Claim) => `[job ${claim.jobId} ${claim.key} attempt ${claim.attempt}]`;

/** 600000 as "10 minutes", 60000 as "60 s". */
const spokenMs = (ms: number) => (ms >= 120_000 && ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${Math.round(ms / 1000)} s`);

function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`a turn's plan has no ${what}`);
  return value;
}

/** A reason in a few words, for the player: its first line, cut short. */
function shortly(reason: string): string {
  const line = reason.split("\n")[0]!.trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
