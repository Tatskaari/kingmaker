import { roomDepartures, type RoomDeparture } from "./room-departures.js";
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
  departed?(event: RoomDeparture): void;
  error(error: unknown): void;
}

/** Authority-side timing. Clients only need the persisted movement and position reader. */
export function createMovementService(authority: MovementAuthority, clock: MovementClock = movementClock) {
  const jobs = new Map<string, { id: string; report(): void; stop(): void; settle(outcome: MovementOutcome): void; fail(error: unknown): void }>();
  const keyFor = (actorId: string) => {
    const actor = movementActor(authority.currentSimulation(), actorId);
    if (!actor) throw new Error("Actor is missing or ambiguous.");
    return actor.instanceId || actor.characterId;
  };
  const publish = () => { try { authority.changed(); } catch (error) { authority.error(error); } };
  function discard(key: string, outcome: MovementOutcome) {
    const job = jobs.get(key);
    if (job) { jobs.delete(key); job.stop(); job.settle(outcome); }
  }
  function watch(key: string, resumed = false): Promise<MovementOutcome> {
    const movement = movementActor(authority.currentSimulation(), key)?.movement;
    if (!movement) return Promise.resolve("arrived");
    return new Promise((settle, fail) => {
      const departures = authority.departed ? roomDepartures(authority.currentSimulation().map!, key, movement)
        .filter(event => !resumed || event.atMs > clock.now()) : [];
      const report = () => {
        while (departures[0] && departures[0].atMs <= clock.now()) authority.departed!(departures.shift()!);
      };
      const delay = () => Math.max(0, Math.min(departures[0]?.atMs ?? Infinity,
        movement.startedAtMs + movement.durationMs) - clock.now());
      const job = { id: movement.id, report, stop: () => {}, settle, fail };
      jobs.set(key, job);
      const tick = async () => {
        try {
          let completed = false;
          await authority.write(() => {
            if (jobs.get(key) !== job) return;
            const current = movementActor(authority.currentSimulation(), key)?.movement;
            if (current?.id !== job.id) { discard(key, "superseded"); return; }
            report();
            const remaining = current.startedAtMs + current.durationMs - clock.now();
            if (remaining > 0) { job.stop = clock.schedule(() => void tick(), delay()); return; }
            authority.executeMove(completeMove, key, job.id, clock.now());
            completed = true;
            publish();
          });
          if (completed && jobs.get(key) === job) { jobs.delete(key); settle("arrived"); }
        } catch (error) {
          if (jobs.get(key) === job) jobs.delete(key);
          fail(error);
        }
      };
      job.stop = clock.schedule(() => void tick(), delay());
    });
  }
  async function cancel(actorId: string, expectedId?: string) {
    await authority.write(() => {
      const key = keyFor(actorId), movement = movementActor(authority.currentSimulation(), key)?.movement;
      if (!movement || (expectedId && movement.id !== expectedId)) return;
      jobs.get(key)?.report();
      authority.executeMove(cancelMove, key, movement.id, clock.now());
      discard(key, "cancelled");
      publish();
    });
  }
  return {
    async move(actorId: string, request: Omit<StartMovement, "startedAtMs">, signal?: AbortSignal): Promise<MovementOutcome> {
      let completion: Promise<MovementOutcome> | undefined;
      await authority.write(() => {
        signal?.throwIfAborted();
        const key = keyFor(actorId);
        jobs.get(key)?.report();
        authority.executeMove(startMove, key, { ...request, startedAtMs: clock.now() });
        discard(key, "superseded");
        completion = watch(key);
        // Attach immediately, including if persistence yields before we return it.
        void completion.catch(() => {});
        // Publish the accepted state before write() awaits durable storage.
        publish();
      });
      const abort = () => { void cancel(actorId, request.id).catch(authority.error); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      try { return await completion!; }
      finally { signal?.removeEventListener("abort", abort); }
    },
    cancel,
    now: () => clock.now(),
    /** Load starts fresh timers; pending interaction callbacks are intentionally not saved. */
    resume() {
      for (const actor of authority.currentSimulation().map?.actors ?? []) {
        const key = actor.instanceId || actor.characterId;
        if (actor.movement && !jobs.has(key)) void watch(key, true).catch(authority.error);
      }
    },
    dispose() { for (const key of jobs.keys()) discard(key, "cancelled"); },
  };
}
