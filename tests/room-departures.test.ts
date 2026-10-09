import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { createMovementService } from "../packages/core/src/movement-service.js";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";
import type { RoomDeparture } from "../packages/core/src/room-departures.js";

function fixture() {
  let now = 0, state = create(SimulationStateSchema, { map: {
    rooms: [{ id: "hall" }, { id: "parlor" }, { id: "garden" }],
    layout: { width: 6, height: 1, tiles: Array.from({ length: 6 }, () => ({ layers: [{ solid: false }] })),
      rooms: ["hall", "parlor", "garden"].map((id, i) => ({ id, regions: [{ x: i * 2, y: 0, width: 2, height: 1 }] })) },
    actors: [{ characterId: "player", position: { x: 0, y: 0 }, roomId: "hall" }],
    doors: [{ id: "parlor-door", open: true, roomIds: ["hall", "parlor"], tiles: [{ x: 2, y: 0 }] }],
  } });
  const events: RoomDeparture[] = [], jobs = new Set<{ at: number; call(): void }>();
  const service = createMovementService({ currentSimulation: () => state,
    executeMove: (move, ...args) => { state = executeLocalMove(state, move, ...args); },
    write: async work => work(), changed() {}, error: error => { throw error; }, departed: event => events.push(event),
  }, { now: () => now, schedule(call, delay) { const job = { at: now + delay, call }; jobs.add(job); return () => { jobs.delete(job); }; } });
  return { service, events, state: () => state, async tick(ms: number) {
    now += ms;
    for (const job of [...jobs]) if (job.at <= now) { jobs.delete(job); job.call(); }
    await new Promise<void>(resolve => setImmediate(resolve));
  }, elapse(ms: number) { now += ms; } };
}
const request = { id: "walk", to: { x: 5, y: 0 }, msPerTile: 100 };

test("departure fires at each crossing, names the exit and precedes final arrival", async () => {
  const f = fixture(), moving = f.service.move("player", request);
  await f.tick(149); assert.equal(f.events.length, 0);
  await f.tick(1);
  assert.deepEqual(f.events[0], { id: "walk:exit:2", actorId: "player", fromRoomId: "hall", toRoomId: "parlor",
    doorId: "parlor-door", position: { x: 1, y: 0 }, atMs: 150 });
  assert.ok(f.state().map!.actors[0]!.movement, "The actor is still travelling");
  await f.tick(200); assert.equal(f.events[1]!.toRoomId, "garden");
  assert.equal(f.events[1]!.doorId, undefined, "Open passages are not invented doors");
  await f.tick(150); assert.equal(await moving, "arrived");
  assert.equal(f.events.length, 2);
});

test("cancellation and redirection retain only crossings actually reached", async () => {
  const f = fixture(), moving = f.service.move("player", request);
  f.elapse(175); // Cancel before a delayed timer can publish the crossing.
  await f.service.cancel("player"); assert.equal(await moving, "cancelled");
  assert.equal(f.events.length, 1);
  const returning = f.service.move("player", { ...request, id: "return", to: { x: 0, y: 0 } });
  await f.tick(200); assert.equal(await returning, "arrived");
  assert.deepEqual(f.events.map(event => event.toRoomId), ["parlor", "hall"]);
  await f.tick(1000); assert.equal(f.events.length, 2);
});

test("resuming a saved movement skips past crossings and reports only future departures", async () => {
  const f = fixture(), moving = f.service.move("player", request);
  await f.tick(150); f.service.dispose(); assert.equal(await moving, "cancelled");
  f.service.resume(); await f.tick(350);
  assert.deepEqual(f.events.map(event => event.toRoomId), ["parlor", "garden"]);
});
