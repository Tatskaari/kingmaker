import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/index.js";
import { createPhysicalEvent } from "../apps/web/src/physical-event.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("physical events retain actor position, day, participants and details without character state", () => {
  const map = create(WorldStateSchema, { day: 7, actors: [{ characterId: "visitor", position: { x: 3, y: 4 } }] });
  const event = createPhysicalEvent(map, "opening", "Opened the chest", ["visitor"], { fixtureId: "chest" });
  assert.match(event.id, /^event-/);
  assert.equal(event.day, 7);
  assert.deepEqual(event.position, map.actors[0]!.position);
  assert.deepEqual(event.participantIds, ["visitor"]);
  assert.deepEqual(event.details, { fixtureId: "chest" });
  assert.equal(createPhysicalEvent(map, "unknown", "No body", ["missing"]).position, undefined);
  assert.equal(createPhysicalEvent(undefined, "unknown", "No map", []).day, 0);
});

test("document-world event creation does not inspect lore and uses the participating guard body", t => {
  const world = loadPlayableWorld(), bodies = world.map!.actors.filter(actor => actor.characterId.startsWith("palace-guard-"));
  world.map!.actors.find(actor => actor.characterId === "player")!.position = { ...bodies.at(-1)!.position! };
  const host = new WorldHost(world), before = host.snapshot();
  const event = host.worldEvent("speaking", "The guard spoke", [bodies.at(-1)!.characterId]);
  assert.deepEqual(event.position, bodies.at(-1)!.position);
  assert.deepEqual(host.snapshot(), before);
  const detached = host.world();
  for (const document of Object.values(detached.docs)) {
    Object.defineProperty(document, "body", { get() { throw new Error("Unexpected lore read"); } });
  }
  t.mock.method(host, "world", () => detached);
  assert.equal(host.worldEvent("speaking", "The guard spoke", [bodies.at(-1)!.characterId]).summary, event.summary);
});
