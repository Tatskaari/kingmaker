import { ScheduleAt, Timestamp } from "spacetimedb";
import type { Endpoint } from "../../shared/protocol/ai.ts";
import type { Step } from "../../shared/protocol/keys.ts";
import type { AiOutcome, Claim } from "./ai-call.ts";
import type { TxCtx } from "./context.ts";
import type { Move } from "./moves/move.ts";
import { moveNamed } from "./moves/registry.ts";
import { turnRow, updateTurn, type JobRow } from "./rows.ts";

/**
 * The job loop (v0-design §3.5). One `job` row per turn and move in flight holds its plan and the
 * request to POST next, keyed by the step's idempotency key; each `job_dispatch` row runs run_job
 * once (claim, POST with nothing locked, commit). A POST that can be tried again leaves the job
 * waiting, and the reaper dispatches it at its time; one that can't fails the turn, which waits for
 * retry_turn. A job whose procedure died (the server stopped mid-think) is dispatched again after its
 * deadline. Every function here is a pure function of the rows, the claim and the answer: withTx may
 * run one twice.
 *
 * A job beside a turn's own steps (the notes, the lines: v5-design §3.4) runs on the same loop, and
 * its move says how it differs: whether an answer still applies, what giving up on it does and when,
 * and that it's in the background, so its retries say nothing on the turn and it never fails it.
 */

/** What every move's plan carries for its job row: the game, scene and turn (ids as strings) and the step it thinks next. */
export interface JobPlan { step: Step; game: string; scene: string; turn: string }

/** Seconds before each try again: after the first failure, the second, …; then every 15 s. */
const RETRY_SECONDS = [1, 2, 4, 8, 15];
/** A running job's deadline is its POST's timeout and this: past it, the procedure has died. */
const GRACE_MS = 10_000;
/** A queued job with no dispatch for this long (its procedure died before claiming it) gets another. */
const FORGOTTEN_MS = 10_000;
/** Failing for this long, a job fails its turn rather than trying on (unless its move says otherwise). */
const GIVE_UP_MS = 10 * 60_000;
/** The turn's note while the job waits to try again. */
export const LOST_THREAD = "The GM has lost the thread for a moment: trying again.";

/**
 * A new move's think: its job row (the plan, and the request built from the rows this transaction
 * sees) and a dispatch now. One row a turn and move: one the move already has for the turn is
 * written over, and an answer to what it held is dropped as stale.
 */
export function queueThink<P extends JobPlan>(tx: TxCtx, move: Move<unknown, P>, plan: P): void {
  const think = { ...thinkOf(tx, move, plan), ...freshState(tx) };
  const old = jobOf(tx, BigInt(plan.turn), move.name);
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
 * claim (the reaper dispatched it again); an answer is committed while it still applies (for a
 * turn's own steps, while the scene's lease is this turn's), and the move goes on to its next think
 * or ends; a retry waits; anything else can't finish.
 */
export function finishJob(tx: TxCtx, claim: Claim, outcome: AiOutcome): void {
  const job = claimedJob(tx, claim);
  if (!job) return tx.log(`${label(claim)} dropped: the job has moved on since this dispatch`);

  if (outcome.kind === "retry") return waitToRetry(tx, job, claim, outcome.reason);
  if (outcome.kind === "fatal") return cantFinish(tx, job, label(claim), outcome.reason);
  if (!stillApplies(tx, job)) return dropJob(tx, job, claim);

  commitAnswer(tx, job, claim, outcome);
}

/** run_job's last word when a commit throws: the job can't finish (a turn's own step fails the turn, the lease kept, so the scene waits for retry_turn). */
export function failJob(tx: TxCtx, claim: Claim, reason: string): void {
  const job = tx.db.job.id.find(claim.jobId);
  if (!job || job.key !== claim.key || job.state === "failed") return;
  cantFinish(tx, job, label(claim), reason);
}

/** reap_jobs, every 2 s: what has failed too long fails; what waited long enough, overran its deadline, or lost its dispatch, is dispatched. */
export function reapJobs(tx: TxCtx): void {
  giveUpOnLongFailures(tx);
  retryWaiting(tx);
  redispatchOverdue(tx);
  redispatchForgotten(tx);
}

/** retry_turn's: a failed job queued again from its first attempt, with a dispatch. */
export function retryJob(tx: TxCtx, job: JobRow): void {
  tx.db.job.id.update({ ...job, ...freshState(tx) });
  dispatch(tx, job.id);
  tx.log(`[job ${job.id} ${job.key}] queued again by retry_turn`);
}

/** The failed job of a turn's own steps, if it has one: a background job is never the turn's to retry. */
export function failedJobOf(tx: TxCtx, turnId: bigint): JobRow | undefined {
  return [...tx.db.job.turnId.filter(turnId)].find(j => j.state === "failed" && !moveOf(j).background);
}

// ---------------------------------------------------------------------------------------------
// finishJob's parts.

/** The job as the claim left it: still running, on this attempt. */
function claimedJob(tx: TxCtx, claim: Claim): JobRow | undefined {
  const job = tx.db.job.id.find(claim.jobId);
  return job && job.state === "running" && job.attempts === claim.attempt && job.key === claim.key ? job : undefined;
}

/** The answer is still wanted: as its move says, or (a turn's own step) while the scene waits on this turn. */
function stillApplies(tx: TxCtx, job: JobRow): boolean {
  const move = moveOf(job);
  return move.applies ? move.applies(tx, planOf(job)) : leaseHeld(tx, job);
}

/** The scene still waits on this turn: its lease is the turn's, and it hasn't ended. */
function leaseHeld(tx: TxCtx, job: JobRow): boolean {
  const scene = tx.db.scene.id.find(job.sceneId);
  return !!scene && scene.turnId === job.turnId && scene.status !== "ended";
}

/** The answer applied by its move; then the move's next think, or its end. */
function commitAnswer(tx: TxCtx, job: JobRow, claim: Claim, answer: Extract<AiOutcome, { kind: "answer" }>): void {
  const move = moveOf(job);
  addUsage(tx, job, answer.answer);

  const next = move.commit!(tx, planOf(job), answer.answer);

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

/** The answer's model calls and cost, added to its turn's (the notes' and the lines' too); for a turn's own step, the note that it was waiting cleared. */
function addUsage(tx: TxCtx, job: JobRow, answer: unknown): void {
  const usage = (answer as { usage?: { calls?: unknown; costUsd?: unknown } } | null)?.usage;
  const calls = typeof usage?.calls === "number" ? Math.max(0, Math.round(usage.calls)) : 0;
  const cost = typeof usage?.costUsd === "number" ? Math.max(0, Math.round(usage.costUsd * 1_000_000)) : 0;
  const turn = turnRow(tx, job.turnId);
  const waited = moveOf(job).background ? {} : { note: undefined };
  tx.db.turn.id.update({ ...turn, calls: turn.calls + calls, costMicros: turn.costMicros + BigInt(cost), ...waited });
}

/** The scene no longer waits on this turn (it ended, or another turn holds the lease): the move stops, keeping what was committed. */
function dropJob(tx: TxCtx, job: JobRow, claim: Claim): void {
  tx.db.job.id.delete(job.id);
  tx.log(`${label(claim)} dropped: scene ${job.sceneId} no longer waits on turn ${job.turnId}`);
}

/** Try again later: waiting until retryAt (1, 2, 4, 8, then every 15 s), and the turn says so (unless the job is in the background). */
function waitToRetry(tx: TxCtx, job: JobRow, claim: Claim, reason: string): void {
  const seconds = RETRY_SECONDS[Math.min(claim.attempt, RETRY_SECONDS.length) - 1]!;
  tx.db.job.id.update({ ...job, state: "waiting", retryAt: after(tx.now, seconds * 1000), deadline: undefined, failingSince: job.failingSince ?? tx.now, error: reason, updatedAt: tx.now });
  sayWaiting(tx, job);
  tx.log(`${label(claim)} ${reason}: waiting, retry in ${seconds} s`);
}

/**
 * A job that can't finish: a status trying again won't mend, a commit that threw, or failing too
 * long. Its move gives up on it, and the row goes; without a giveUp, the turn fails with it.
 */
function cantFinish(tx: TxCtx, job: JobRow, who: string, reason: string): void {
  const move = moveOf(job);
  if (!move.giveUp) return failJobRow(tx, job, who, reason);

  tx.db.job.id.delete(job.id);
  move.giveUp(tx, planOf(job), reason);
  tx.log(`${who} gave up: ${reason}`);
}

/** The job failed, and its turn with it: the draft gone, the lease kept, so the scene waits for retry_turn. */
function failJobRow(tx: TxCtx, job: JobRow, who: string, reason: string): void {
  tx.db.job.id.update({ ...job, state: "failed", error: reason, deadline: undefined, retryAt: undefined, updatedAt: tx.now });
  updateTurn(tx, job.turnId, { phase: "failed", error: `The GM couldn't answer: ${shortly(reason)}`, note: undefined });
  tx.db.replyDraft.turnId.delete(job.turnId);
  tx.log(`${who} failed: ${reason}`);
}

// ---------------------------------------------------------------------------------------------
// The reaper's parts.

function giveUpOnLongFailures(tx: TxCtx): void {
  for (const job of jobsIn(tx, "waiting", "running")) {
    const limit = moveOf(job).giveUpMs ?? GIVE_UP_MS;
    if (job.failingSince && msBetween(job.failingSince, tx.now) >= limit) cantFinish(tx, job, `[reaper] job ${job.id} ${job.key}`, `no answer for ${spokenMs(limit)} (last: ${job.error ?? "none"})`);
  }
}

function retryWaiting(tx: TxCtx): void {
  for (const job of jobsIn(tx, "waiting")) {
    if (job.retryAt && job.retryAt.microsSinceUnixEpoch > tx.now.microsSinceUnixEpoch) continue;
    tx.db.job.id.update({ ...job, state: "queued", retryAt: undefined, updatedAt: tx.now });
    dispatch(tx, job.id);
    tx.log(`[reaper] job ${job.id} ${job.key} dispatched again (attempt ${job.attempts + 1})`);
  }
}

/** A running job past its deadline: its procedure died with the server, or its POST never came back. */
function redispatchOverdue(tx: TxCtx): void {
  for (const job of jobsIn(tx, "running")) {
    if (!job.deadline || job.deadline.microsSinceUnixEpoch > tx.now.microsSinceUnixEpoch) continue;
    tx.db.job.id.update({ ...job, state: "queued", deadline: undefined, failingSince: job.failingSince ?? tx.now, error: "no answer by its deadline", updatedAt: tx.now });
    sayWaiting(tx, job);
    dispatch(tx, job.id);
    tx.log(`[reaper] job ${job.id} ${job.key} re-dispatched after its deadline`);
  }
}

/** A queued job whose dispatch was consumed by a procedure that died before claiming it. */
function redispatchForgotten(tx: TxCtx): void {
  const dispatched = new Set([...tx.db.jobDispatch.iter()].map(d => d.jobId));
  for (const job of jobsIn(tx, "queued")) {
    if (dispatched.has(job.id) || msBetween(job.updatedAt, tx.now) < FORGOTTEN_MS) continue;
    tx.db.job.id.update({ ...job, updatedAt: tx.now });
    dispatch(tx, job.id);
    tx.log(`[reaper] job ${job.id} ${job.key} had no dispatch: dispatched`);
  }
}

// ---------------------------------------------------------------------------------------------
// The rows.

/** A think's columns: where it goes, its key, the request built now from the rows, the plan. */
function thinkOf<P extends JobPlan>(tx: TxCtx, move: Move<unknown, P>, plan: P) {
  const call = move.think!(tx, plan);
  return {
    key: call.key, gameId: BigInt(plan.game), sceneId: BigInt(plan.scene), turnId: BigInt(plan.turn), move: move.name, step: plan.step,
    endpoint: call.endpoint, timeoutMs: call.timeoutMs, request: JSON.stringify(call.request), plan: JSON.stringify(plan),
  };
}

/** A job ready for its first attempt. */
const freshState = (tx: TxCtx) => ({ state: "queued", attempts: 0, deadline: undefined, retryAt: undefined, failingSince: undefined, error: undefined, updatedAt: tx.now });

/** The move's job for a turn, if it has one in flight. */
const jobOf = (tx: TxCtx, turnId: bigint, move: string): JobRow | undefined => [...tx.db.job.turnId.filter(turnId)].find(j => j.move === move);

/** The move a job row is for, and its plan. */
const moveOf = (job: JobRow) => moveNamed(job.move);
const planOf = (job: JobRow) => JSON.parse(job.plan) as JobPlan;

/** The turn says it's waiting on the AI service: for its own steps only, never for a job in the background. */
function sayWaiting(tx: TxCtx, job: JobRow): void {
  if (!moveOf(job).background) updateTurn(tx, job.turnId, { note: LOST_THREAD });
}

/** run_job for this job, about 3 ms after this transaction commits. */
function dispatch(tx: TxCtx, jobId: bigint): void {
  tx.db.jobDispatch.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(tx.now.microsSinceUnixEpoch), jobId });
}

const jobsIn = (tx: TxCtx, ...states: string[]): JobRow[] => states.flatMap(s => [...tx.db.job.state.filter(s)]);

const after = (t: Timestamp, ms: number) => new Timestamp(t.microsSinceUnixEpoch + BigInt(Math.round(ms)) * 1000n);

const msBetween = (from: Timestamp, to: Timestamp) => Number((to.microsSinceUnixEpoch - from.microsSinceUnixEpoch) / 1000n);

const label = (claim: Claim) => `[job ${claim.jobId} ${claim.key} attempt ${claim.attempt}]`;

/** 600000 as "10 minutes", 60000 as "60 s". */
const spokenMs = (ms: number) => (ms >= 120_000 && ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${Math.round(ms / 1000)} s`);

/** A reason in a few words, for the player: its first line, cut short. */
function shortly(reason: string): string {
  const line = reason.split("\n")[0]!.trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
