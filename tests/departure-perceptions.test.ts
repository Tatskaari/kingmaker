import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { roomAt } from "../packages/core/src/pathfinding.js";
import { loadPlayableWorld } from "./fixtures.js";

function fixture(mover: string) {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  map.doors.find(door => door.id === "guest_door")!.open = true;
  const place = (id: string, x: number, y: number) => {
    const actor = map.actors.find(actor => actor.characterId === id)!;
    actor.position = { ...actor.position!, x, y };
    actor.roomId = roomAt(map.layout!, actor.position)!.id;
  };
  place(mover, 55, 25); place("corvin", 56, 25); place("oswin", 61, 8);
  if (mover !== "player") place("player", 56, 26);
  let now = 0;
  const timers = new Set<{ at: number; call(): void }>();
  const game = new WorldGameRuntime(world, "", undefined, undefined, error => assert.fail(error), {
    services: { random: { integer: () => 1 }, ai: { responses: async () => { throw new Error("No GM review should run"); } } },
    movementClock: { now: () => now, schedule(call, delay) {
      const timer = { at: now + delay, call }; timers.add(timer); return () => { timers.delete(timer); };
    } },
  });
  return { game, async tick(ms: number) {
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.call(); }
    await new Promise<void>(resolve => setImmediate(resolve));
  } };
}

for (const mover of ["player", "rowan"]) test(`${mover} departure reaches nearby observers at the exit, without a GM review`, async () => {
  const f = fixture(mover);
  const moving = f.game.movement.move(mover, { id: "leave", to: { x: 51, y: 25 }, msPerTile: 100 });
  await f.tick(0);
  await f.tick(200);
  const history = f.game.map.observe("corvin").recentHistory!;
  assert.equal(history.length, 1);
  assert.equal(history[0]!.kind, "event");
  assert.match(history[0]!.text, /left Great Hall through Parlour door toward Nobles' Parlour/);
  assert.ok(f.game.world().simulation!.map!.actors.find(actor => actor.characterId === mover)!.movement, "Observed before arrival");
  assert.deepEqual(f.game.map.observe("oswin").recentHistory, [], "No world-wide knowledge leak");
  assert.deepEqual(f.game.map.observe(mover).recentHistory, [], "Not a perception of one's own departure");
  if (mover !== "player") assert.match(f.game.snapshot().playerMessages.at(-1)!.message, /Parlour door/);
  await f.tick(200); assert.equal(await moving, "arrived");
  assert.equal(f.game.map.observe("corvin").recentHistory!.length, 1);
});
