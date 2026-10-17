import type { ChangeSet, MemoryHost } from "../../simulation/src/host/memory.ts";
import { requeueRunning } from "../../simulation/src/jobs.ts";
import { markOnline } from "../../simulation/src/lifecycle.ts";

/**
 * The simulation's jobs, run as SpacetimeDB's scheduler runs them (browser-design §4.2), on the
 * page's own time. After a commit that dispatched a think (a job_dispatch row inserted: by a move, a
 * job's finish or the reaper), every due dispatch is started (dispatchDue: the claims commit in
 * order, the POSTs overlap, and each answer commits as it lands), a moment later, so the move's tx
 * and answer go first and nothing runs inside a commit. The reaper runs on its row's interval. A run
 * is never drain()'s, which waits on each in turn.
 *
 * At a start, nothing that was running has survived (recoverAfterRestart): every running job is
 * dispatched again now (the same step with the same key, so an answer the AI service kept is
 * replayed), and nobody is online yet.
 */

export interface Jobs {
  /** A committed transaction: the dispatches it made started, a moment later. */
  afterCommit(changes: ChangeSet): void;
  /** Resolves once no job is running or due and none is about to start: a test's way to wait for the thinks to come in. */
  idle(): Promise<void>;
  /** Nothing more started, and the reaper stopped: another tab has the game. */
  stop(): void;
}

/** The reaper's period when its row doesn't say (init's: 2 s). */
const REAP_EVERY_MS = 2000;

export function startJobs(sim: MemoryHost): Jobs {
  const running = new Set<Promise<void>>();
  const waiters: Array<() => void> = [];
  let soon: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const idleNow = () => !running.size && !soon && sim.db.jobDispatch.count() === 0n;
  const settle = () => { if (idleNow()) for (const resolve of waiters.splice(0)) resolve(); };

  /** Every due dispatch started on the next turn of the event loop (once, however many commits ask for it meanwhile). */
  const dispatchSoon = () => {
    if (stopped || soon) return;
    soon = setTimeout(() => {
      soon = undefined;
      for (const run of sim.dispatchDue()) track(run);
      settle();
    }, 0);
  };
  const track = (run: Promise<void>) => {
    running.add(run);
    void run.finally(() => { running.delete(run); settle(); });
  };

  const reaper = setInterval(() => sim.reap(), reapEveryMs(sim));
  // What was due when the database was last kept (a dispatch saved before its run began).
  dispatchSoon();

  return {
    afterCommit(changes) {
      if (changes.changes.some(change => change.table === "jobDispatch" && change.op === "insert")) dispatchSoon();
    },
    idle: () => new Promise(resolve => { waiters.push(resolve); settle(); }),
    stop() {
      stopped = true;
      clearTimeout(soon);
      soon = undefined;
      clearInterval(reaper);
    },
  };
}

/** A start after the page went: every job that was running dispatched again now, and every seated player offline, in one transaction. */
export function recoverAfterRestart(sim: MemoryHost): void {
  sim.transact(tx => {
    requeueRunning(tx);
    for (const seat of tx.db.seat.iter()) markOnline(tx, seat.identity, false);
  });
}

/** The reaper row's interval, as SpacetimeDB schedules reap_jobs by it. */
function reapEveryMs(sim: MemoryHost): number {
  const at = [...sim.db.reaper.iter()][0]?.scheduledAt;
  return at?.tag === "Interval" ? Number(at.value.micros / 1000n) : REAP_EVERY_MS;
}
