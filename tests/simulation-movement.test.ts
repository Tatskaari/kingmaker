import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "boardgame.io/client";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";
import { startMove, completeMove, cancelMove, getActorPosition } from "../packages/core/src/simulation-movement.js";

const setup = () => create(SimulationStateSchema, { map: {
  layout: { width: 4, height: 2, tileWidth: 16, tileHeight: 16,
    tiles: Array.from({ length: 8 }, () => ({ layers: [{ solid: false }] })),
    rooms: [{ id: "hall", regions: [{ x: 0, y: 0, width: 4, height: 2 }] }],
  }, actors: [{ instanceId: "one", characterId: "guard", position: { x: 0, y: 0 } },
    { instanceId: "two", characterId: "guard", position: { x: 0, y: 1 } }],
} });
const request = { id: "walk", to: { x: 3, y: 0 }, startedAtMs: 1000, msPerTile: 100 };

test("headless moves interpolate, cancel, reverse and ignore stale completion", () => {
  const original = setup();
  let G = executeLocalMove(original, startMove, "one", request);
  assert.deepEqual(getActorPosition(G, "one", 1150), { x: 1.5, y: 0 });
  assert.equal(original.map!.actors[0]!.movement, undefined);
  assert.equal(G.map!.actors[1], original.map!.actors[1]);
  assert.throws(() => executeLocalMove(G, completeMove, "one", "walk", 1100), /Invalid/);
  G = executeLocalMove(G, cancelMove, "one", "walk", 1150);
  assert.equal(G.map!.actors[0]!.position!.x, 1.5);
  assert.equal(G.map!.actors[0]!.movement, undefined);
  G = executeLocalMove(G, startMove, "one", { ...request, id: "reverse", to: { x: 0, y: 0 }, startedAtMs: 1150 });
  assert.equal(G.map!.actors[0]!.movement!.durationMs, 150);
  assert.deepEqual(getActorPosition(G, "one", 1175), { x: 1.25, y: 0 });
  assert.throws(() => executeLocalMove(G, completeMove, "one", "walk", 1400), /Invalid/);
  G = executeLocalMove(G, completeMove, "one", "reverse", 1300);
  assert.deepEqual(getActorPosition(G, "one", 1300), { x: 0, y: 0 });
  assert.equal(G.map!.actors[0]!.roomId, "hall");
  assert.equal(G.map!.actors[0]!.movement, undefined);
});

test("headless boardgame.io accepts the same movement functions and concurrent bodies", () => {
  const client = Client({ game: { setup, moves: { startMove, completeMove, cancelMove } } });
  client.start();
  client.moves.startMove!("one", request);
  client.moves.startMove!("two", { ...request, id: "other", to: { x: 2, y: 1 } });
  const G = client.getState()!.G;
  assert.deepEqual(getActorPosition(G, "one", 1150), { x: 1.5, y: 0 });
  assert.deepEqual(getActorPosition(G, "two", 1150), { x: 1.5, y: 1 });
  client.moves.completeMove!("two", "other", 1200);
  assert.ok(client.getState()!.G.map!.actors[0]!.movement);
  assert.equal(client.getState()!.G.map!.actors[1]!.movement, undefined);
  client.stop();
});

test("invalid routes and ambiguous character identities do not publish changes", () => {
  const G = setup();
  assert.throws(() => executeLocalMove(G, startMove, "guard", request), /Invalid/);
  assert.throws(() => executeLocalMove(G, startMove, "one", { ...request, to: { x: 9, y: 0 } }), /Invalid/);
  assert.equal(G.map!.revision, 0);
});
