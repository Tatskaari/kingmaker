import type { SimulationState } from "../../contracts/src/v2.js";
import type { SimulationMove } from "./simulation-move.js";
import { cancelMove, completeMove, movementActor, startMove, type StartMovement } from "./simulation-movement.js";

export type MovementOutcome = "arrived" | "cancelled" | "superseded";
export interface MovementClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
export const movementClock: MovementClock = {
  now: () => Date.now(),
  schedule(callback, delayMs) { const timer = setTimeout(callback, Math.min(delayMs, 2_147_483_647)); return () => clearTimeout(timer); },
};
export interface MovementAuthority {
  currentSimulation(): SimulationState;
  executeMove<Args extends unknown[]>(move: SimulationMove<Args>, ...args: Args): void;
  /** Serialize/persist only the update, never the time spent travelling. */
  write<T>(work: () => T): Promise<T>;
  changed(): void;
  error(error: unknown): void;
}

/** Authority-side timing. Clients only need the persisted movement and position reader. */
export function createMovementService(authority: MovementAuthority, clock: MovementClock = movementClock) {
  const jobs = new Map<string, { id: string; stop(): void; settle(outcome: MovementOutcome): void; fail(error: unknown): void }>();
  const keyFor = (actorId: string) => {
    const actor = movementActor(authority.currentSimulation(), actorId);
    if (!actor) throw new Error("Actor is missing or ambiguous.");
    return actor.instanceId || actor.characterId;
  };
  function discard(key: string, outcome: MovementOutcome) {
    const job = jobs.get(key);
    if (job) { jobs.delete(key); job.stop(); job.settle(outcome); }
  }
  function watch(key: string): Promise<MovementOutcome> {
    const movement = movementActor(authority.currentSimulation(), key)?.movement;
    if (!movement) return Promise.resolve("arrived");
    return new Promise((settle, fail) => {
      const job = { id: movement.id, stop: () => {}, settle, fail };
      jobs.set(key, job);
      const tick = async () => {
        try {
          let completed = false;
          await authority.write(() => {
            if (jobs.get(key) !== job) return;
            const current = movementActor(authority.currentSimulation(), key)?.movement;
            if (current?.id !== job.id) { discard(key, "superseded"); return; }
            const remaining = current.startedAtMs + current.durationMs - clock.now();
            if (remaining > 0) { job.stop = clock.schedule(() => void tick(), remaining); return; }
            authority.executeMove(completeMove, key, job.id, clock.now());
            completed = true;
          });
          if (completed && jobs.get(key) === job) { jobs.delete(key); authority.changed(); settle("arrived"); }
        } catch (error) {
          if (jobs.get(key) === job) jobs.delete(key);
          fail(error);
        }
      };
      job.stop = clock.schedule(() => void tick(), Math.max(0, movement.startedAtMs + movement.durationMs - clock.now()));
    });
  }
  return {
    async move(actorId: string, request: Omit<StartMovement, "startedAtMs">): Promise<MovementOutcome> {
      let completion: Promise<MovementOutcome> | undefined;
      await authority.write(() => {
        const key = keyFor(actorId);
        authority.executeMove(startMove, key, { ...request, startedAtMs: clock.now() });
        discard(key, "superseded");
        completion = watch(key);
        // Attach immediately, including if persistence yields before we return it.
        void completion.catch(() => {});
      });
      authority.changed();
      return completion!;
    },
    async cancel(actorId: string) {
      await authority.write(() => {
        const key = keyFor(actorId), movement = movementActor(authority.currentSimulation(), key)?.movement;
        if (!movement) return;
        authority.executeMove(cancelMove, key, movement.id, clock.now());
        discard(key, "cancelled");
      });
      authority.changed();
    },
    /** Load starts fresh timers; pending interaction callbacks are intentionally not saved. */
    resume() {
      for (const actor of authority.currentSimulation().map?.actors ?? []) {
        const key = actor.instanceId || actor.characterId;
        if (actor.movement && !jobs.has(key)) void watch(key).catch(authority.error);
      }
    },
    dispose() { for (const key of jobs.keys()) discard(key, "cancelled"); },
  };
}
