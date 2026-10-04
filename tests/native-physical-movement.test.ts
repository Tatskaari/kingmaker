import assert from "node:assert/strict";
import test from "node:test";
import { courtPath, courtRoomAt } from "../apps/web/src/court-map.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("player movement and doors commit native map state without rebuilding character documents", t => {
  const world = loadPlayableWorld(), door = world.map!.doors.find(door => door.interactionSpots.length)!;
  const player = world.map!.actors.find(actor => actor.characterId === "player")!;
  player.position = { ...door.interactionSpots[0]! };
  door.open = false;
  const host = new WorldHost(world), before = host.world(), revision = before.map!.revision;
  assert.strictEqual(host.world(), before);
  const documents = before.docs, properties = documents[before.player!]!.characterProperties;
  assert.ok(!("projection" in host));
  const event = host.setDoor(door.id, true);
  assert.match(event.summary, /opened/);
  assert.equal(host.world().map!.doors.find(item => item.id === door.id)!.open, true);
  assert.strictEqual(host.world().docs, documents);
  assert.strictEqual(host.world().docs[before.player!]!.characterProperties, properties);
  const map = host.world().map!, position = player.position!;
  const destination = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ x: position.x + x!, y: position.y + y! }))
    .find(point => courtRoomAt(point) && courtPath(position, point, map.doors, map.fixtures))!;
  assert.ok(destination);
  host.movePlayer(destination);
  assert.equal(host.world().map!.revision, revision + 2);
  assert.strictEqual(host.world().docs, documents);
  assert.strictEqual(host.world().docs[before.player!]!.characterProperties, properties);
});

test("occupied doors and unreachable destinations fail without changing the native world", () => {
  const world = loadPlayableWorld(), door = world.map!.doors.find(door => door.interactionSpots.length)!;
  world.map!.actors.find(actor => actor.characterId === "player")!.position = { ...door.interactionSpots[0]! };
  world.map!.actors.find(actor => actor.characterId === "rowan")!.position = { ...door.tiles[0]! };
  door.open = true;
  const host = new WorldHost(world), before = host.snapshot();
  assert.throws(() => host.setDoor(door.id, false), /standing in the doorway/);
  assert.throws(() => host.movePlayer({ x: 0, y: 0 }), /not reachable|outside/);
  assert.deepEqual(host.snapshot(), before);
});

test("moving does not traverse or copy document bodies", () => {
  const host = new WorldHost(loadPlayableWorld());
  const world = host.world(), map = world.map!, player = map.actors.find(actor => actor.characterId === "player")!;
  for (const document of Object.values(world.docs)) Object.defineProperty(document, "body", {
    get() { throw new Error("Movement must not read document bodies"); },
  });
  host.movePlayer({ x: player.position!.x, y: player.position!.y });
  assert.strictEqual(host.world(), world);
  assert.strictEqual(host.world().map, map);
});
