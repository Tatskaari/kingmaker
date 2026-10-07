import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { WorldMapSchema, TilePositionSchema } from "../packages/contracts/src/index.js";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { getActorPosition, mapAtTime } from "../packages/core/src/simulation-movement.js";
import type { MovementClock } from "../packages/core/src/movement-service.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";

function fixture() {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const player = map.actors.find(actor => actor.characterId === "player")!;
  const rowan = map.actors.find(actor => actor.characterId === "rowan")!;
  const room = map.rooms.find(room => room.id === player.roomId)!;
  const drawer = map.fixtures.find(item => item.id === "palace_corvin_drawers")!;
  player.position = create(TilePositionSchema, { x: 0, y: 0 });
  rowan.position = create(TilePositionSchema, { x: 0, y: 1 }); rowan.roomId = room.id;
  drawer.position = create(TilePositionSchema, { x: 3, y: 1 });
  drawer.interactionSpot = create(TilePositionSchema, { x: 2, y: 1 }); drawer.roomId = room.id; drawer.open = true;
  map.actors = [player, rowan]; map.rooms = [room]; map.doors = []; map.fixtures = [drawer];
  map.layout = create(WorldMapSchema, { width: 4, height: 2, tileWidth: 16, tileHeight: 16,
    tiles: Array.from({ length: 8 }, () => ({ layers: [{ solid: false }] })),
    rooms: [{ id: room.id, regions: [{ x: 0, y: 0, width: 4, height: 2 }] }],
  });
  assignActivity(world, "rowan", "Take the key.");
  let now = 1000;
  const jobs = new Set<{ due: number; run(): void }>();
  const clock: MovementClock = { now: () => now, schedule(run, delay) {
    const job = { due: now + delay, run }; jobs.add(job); return () => { jobs.delete(job); };
  } };
  const live = new WorldHeadlessGame(world, "", { movementClock: clock });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  return { live, flush, jobs, now: () => now, async advance(ms: number) {
    now += ms;
    for (const job of [...jobs]) if (job.due <= now) { jobs.delete(job); job.run(); }
    await flush();
  } };
}

test("production headless runtime moves player and NPC concurrently, then applies the NPC interaction", async () => {
  const f = fixture(), { live } = f;
  const walking = live.move(3, 0);
  const taking = live.runtime.stepNpcAction("rowan", "take_palace_royal_key", "Take the key.");
  await f.flush();
  assert.equal(live.inspect().simulation!.map!.actors.filter(actor => actor.movement).length, 2);
  assert.ok(!live.inspect().simulation!.runtimeCharacters.rowan!.inventory?.items.some(item => item.id === "palace_royal_key"));
  await f.advance(50);
  assert.deepEqual(getActorPosition(live.inspect().simulation!, "player", f.now()), { x: 0.5, y: 0 });
  const observation = live.runtime.map.observe("player");
  assert.equal(observation.map.actors.find(actor => actor.characterId === "player")!.position!.x, 0.5);
  assert.equal(live.inspect().simulation!.map!.actors.find(actor => actor.characterId === "player")!.position!.x, 0);
  await f.advance(250);
  assert.equal((await walking).done, true);
  assert.equal((await taking).done, true);
  assert.ok(live.inspect().simulation!.runtimeCharacters.rowan!.inventory!.items.some(item => item.id === "palace_royal_key"));
  assert.equal(live.inspect().simulation!.map!.actors.some(actor => actor.movement), false);
  assert.equal(f.jobs.size, 0);
});

test("headless cancellation suppresses a fixture continuation and preserves fractional position", async () => {
  const f = fixture(), { live } = f;
  const taking = live.act("take_palace_royal_key");
  await f.flush(); await f.advance(50);
  await live.runtime.movement.cancel("player");
  const cancelled = await taking;
  assert.ok("done" in cancelled);
  assert.equal(cancelled.done, false);
  const G = live.inspect().simulation!;
  assert.equal(G.map!.actors[0]!.position!.x, 0.5);
  assert.ok(!G.runtimeCharacters.player!.inventory?.items.some(item => item.id === "palace_royal_key"));
  assert.ok(G.map!.fixtures[0]!.inventory!.items.some(item => item.id === "palace_royal_key"));
});

test("headless save/load rebuilds completion timers and leaves live position anchors intact", async () => {
  const f = fixture(), { live } = f;
  const walking = live.move(3, 0);
  await f.flush(); await f.advance(125);
  const map = live.inspect().simulation!.map!;
  assert.equal(mapAtTime(map, f.now()).actors[0]!.position!.x, 1.25);
  assert.equal(map.actors[0]!.position!.x, 0);
  live.load(live.snapshot());
  assert.equal((await walking).done, false);
  await f.advance(175);
  assert.equal(live.inspect().simulation!.map!.actors[0]!.position!.x, 3);
  assert.equal(live.inspect().simulation!.map!.actors[0]!.movement, undefined);
  assert.equal(f.jobs.size, 0);
});

test("aborting a headless NPC walk cancels its animation and does not take the item", async () => {
  const f = fixture(), controller = new AbortController();
  const taking = f.live.runtime.stepNpcAction("rowan", "take_palace_royal_key", "Take the key.", controller.signal);
  const rejected = assert.rejects(taking, /abort/i);
  await f.flush(); await f.advance(50);
  controller.abort(); await f.flush(); await rejected;
  const G = f.live.inspect().simulation!;
  const actor = G.map!.actors.find(actor => actor.characterId === "rowan")!;
  assert.equal(actor.position!.x, 0.5);
  assert.equal(actor.movement, undefined);
  assert.ok(G.map!.fixtures[0]!.inventory!.items.some(item => item.id === "palace_royal_key"));
  assert.equal(f.jobs.size, 0);
});
