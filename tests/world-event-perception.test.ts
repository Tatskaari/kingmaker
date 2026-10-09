import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { EventSchema } from "../packages/contracts/src/index.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

const signal = new AbortController().signal;
function eventWorld() {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  // A clear source and moderate listener in the same unobstructed hall.
  map.actors = map.actors.filter(actor => ["rowan", "holt"].includes(actor.characterId));
  map.actors.find(actor => actor.characterId === "rowan")!.position = { $typeName: "kingmaker.v1.TilePosition", x: 58, y: 24 };
  map.actors.find(actor => actor.characterId === "holt")!.position = { $typeName: "kingmaker.v1.TilePosition", x: 62, y: 24 };
  const event = create(EventSchema, { id: "test", participantIds: ["rowan", "unknown"],
    position: map.actors.find(actor => actor.characterId === "rowan")!.position!, kind: "talking", summary: "A secret" });
  return { world, event };
}

test("event perception reads document names without reconstructing character lore or mechanics", async t => {
  const { world, event } = eventWorld();
  const entry = world.characters.find(path => path.includes("/rowan/"))!;
  world.docs[entry]!.frontmatter!.name = "Renamed Rowan";
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: { random: { integer: () => 1 } } });
  // Isolate this consumer's reads after the host has loaded the valid world.
  // The former Scenario projection touched each of these unrelated properties.
  for (const document of Object.values(world.docs)) {
    for (const key of ["body", "characterProperties"]) Object.defineProperty(document, key, {
      get() { throw new Error(`Event perception must not read ${key}`); },
    });
  }
  t.mock.method(runtime, "world", () => world);
  assert.deepEqual(await runtime.assessWorldEvent(event, signal), { reactions: [{ characterId: "holt", level: "Moderate",
    perception: "You notice Renamed Rowan and unknown talking, but cannot make out the details." }] });
  delete world.docs[entry]!.frontmatter!.name;
  assert.match((await runtime.assessWorldEvent(event, signal)).reactions[0]!.perception, /rowan and unknown/);
});

test("event perception rolls and reacts independently for guard instances", async () => {
  const { world, event } = eventWorld();
  const guards = loadPlayableWorld().simulation!.map!.actors.filter(actor => actor.characterId.startsWith("palace-guard-")).slice(0, 2);
  guards.forEach((actor, index) => { actor.position = { ...event.position!, x: 59 + index }; });
  world.simulation!.map!.actors.push(...guards);
  // A guard at the royal back post cannot perceive this Great Hall event.
  const distantGuard = loadPlayableWorld().simulation!.map!.actors.find(actor => actor.characterId === "palace-guard-9")!;
  world.simulation!.map!.actors.push(distantGuard);
  // An unregistered body is not promoted to a character by observation.
  world.simulation!.map!.actors.push({ ...guards[0]!, characterId: "unregistered", instanceId: "orphan" });
  let rolls = 0;
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: { random: { integer: () => { rolls++; return 1; } } } });
  const before = runtime.snapshot();
  const result = await runtime.assessWorldEvent(event, signal);
  assert.equal(rolls, 3);
  assert.deepEqual(result.reactions.map(reaction => reaction.characterId), ["palace-guard-1", "palace-guard-2", "holt"]);
  assert.equal(result.reactions[0]!.perception, event.summary);
  assert.ok(!result.reactions.some(reaction => reaction.characterId === distantGuard.characterId));
  assert.equal(runtime.hasActiveObjective(distantGuard.characterId), false);
  assert.deepEqual(runtime.snapshot(), before);
});

test("cancelled event assessment does not read the world or roll", async t => {
  const { world, event } = eventWorld();
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: { random: { integer: () => { throw new Error("Unexpected roll"); } } } });
  t.mock.method(runtime, "world", () => { throw new Error("Unexpected world read"); });
  await assert.rejects(runtime.assessWorldEvent(event, AbortSignal.abort()), { name: "AbortError" });
});
