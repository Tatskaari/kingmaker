import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";
import { createMovementService, type MovementClock } from "../packages/core/src/movement-service.js";

function fixture(afterWrite: (count: number) => Promise<void> = async () => {}) {
  let writes = 0;
  let now = 1000, G = create(SimulationStateSchema, { map: {
    layout: { width: 4, height: 1, tileWidth: 16, tileHeight: 16,
      tiles: Array.from({ length: 4 }, () => ({ layers: [{ solid: false }] })) },
    actors: [{ characterId: "player", position: { x: 0, y: 0 } }, { characterId: "guard", position: { x: 0, y: 0 } }],
  } });
  const jobs = new Set<{ at: number; callback(): void }>();
  const clock: MovementClock = { now: () => now, schedule(callback, delay) {
    const job = { at: now + delay, callback }; jobs.add(job); return () => { jobs.delete(job); };
  } };
  const errors: unknown[] = [];
  const service = createMovementService({ currentSimulation: () => G,
    executeMove: (move, ...args) => { G = executeLocalMove(G, move, ...args); },
    write: async work => { const result = work(); await afterWrite(++writes); return result; }, changed: () => {}, error: error => errors.push(error),
  }, clock);
  return { service, state: () => G, jobs, errors, async advance(ms: number) {
    now += ms;
    for (const job of [...jobs]) if (job.at <= now) { jobs.delete(job); job.callback(); }
    await new Promise<void>(resolve => setImmediate(resolve));
  } };
}
const request = { id: "first", to: { x: 3, y: 0 }, msPerTile: 100 };

test("authority commits start immediately and finishes concurrent actors on their deadlines", async () => {
  const f = fixture();
  const player = f.service.move("player", request);
  const guard = f.service.move("guard", { ...request, id: "guard", to: { x: 1, y: 0 } });
  assert.equal(f.state().map!.actors[0]!.position!.x, 0);
  assert.equal(f.state().map!.actors[0]!.movement!.durationMs, 300);
  await f.advance(100);
  assert.equal(await guard, "arrived");
  assert.ok(f.state().map!.actors[0]!.movement);
  await f.advance(200);
  assert.equal(await player, "arrived");
  assert.equal(f.state().map!.actors[0]!.position!.x, 3);
  assert.equal(f.jobs.size, 0);
});

test("redirection suppresses the old continuation; cancellation commits interpolated position", async () => {
  const f = fixture();
  const first = f.service.move("player", request);
  await f.advance(150);
  const next = f.service.move("player", { ...request, id: "next", to: { x: 0, y: 0 } });
  assert.equal(await first, "superseded");
  await f.advance(25);
  await f.service.cancel("player");
  assert.equal(await next, "cancelled");
  assert.equal(f.state().map!.actors[0]!.position!.x, 1.25);
  assert.equal(f.jobs.size, 0);
});

test("resume completes saved movement without resurrecting its old continuation", async () => {
  const f = fixture();
  const pending = f.service.move("player", request);
  await f.advance(100);
  f.service.dispose();
  assert.equal(await pending, "cancelled");
  f.service.resume();
  await f.advance(200);
  assert.equal(f.state().map!.actors[0]!.position!.x, 3);
  assert.equal(f.state().map!.actors[0]!.movement, undefined);
  assert.deepEqual(f.errors, []);
});

test("a new move during completion persistence settles the old request instead of stranding it", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(count => count === 2 ? gate : Promise.resolve());
  const first = f.service.move("player", request);
  await f.advance(300);
  const next = f.service.move("player", { ...request, id: "next", to: { x: 0, y: 0 } });
  assert.equal(await first, "superseded");
  release();
  await f.advance(300);
  assert.equal(await next, "arrived");
  assert.equal(f.jobs.size, 0);
});
