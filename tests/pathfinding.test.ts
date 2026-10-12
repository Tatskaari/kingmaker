import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { DoorStateSchema, MapFixtureSchema, WorldMapSchema } from "../packages/contracts/src/index.js";
import { createPathfindingService } from "../packages/core/src/pathfinding.js";

function layout() {
  return create(WorldMapSchema, { width: 3, height: 2, tileWidth: 16, tileHeight: 16,
    tiles: Array.from({ length: 6 }, () => ({ layers: [{ solid: false }] })),
    rooms: [{ id: "left", regions: [{ x: 0, y: 0, width: 2, height: 2 }] },
      { id: "right", regions: [{ x: 2, y: 0, width: 1, height: 2 }] }],
  });
}

test("shared routing has deterministic ties and does not retain dynamic obstacles", () => {
  const map = layout(), routing = createPathfindingService(map);
  const from = { x: 0, y: 0 }, to = { x: 2, y: 1 };
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }];
  assert.deepEqual(routing.findPath(from, to), route);
  const door = create(DoorStateSchema, { tiles: [{ x: 1, y: 0 }, { x: 1, y: 1 }] });
  assert.equal(routing.findPath(from, to, { doors: [door] }), undefined);
  door.open = true;
  assert.deepEqual(routing.findPath(from, to, { doors: [door] }), route);
  assert.deepEqual(routing.findPath(from, to), route);
  assert.equal(map.tiles.length, 6);
  const fixture = create(MapFixtureSchema, { position: to });
  assert.equal(routing.findPath(from, to, { fixtures: [fixture] }), undefined);
});

test("shared reachability labels follow doors and fixtures without depending on actor positions", () => {
  const map = layout(), tiles = map.tiles;
  let tileReads = 0;
  Object.defineProperty(map, "tiles", { configurable: true, get() { tileReads++; return tiles; } });
  const routing = createPathfindingService(map);
  const leftTop = { x: 0, y: 0 }, leftBottom = { x: 0, y: 1 }, right = { x: 2, y: 1 };
  assert.equal(routing.isReachable(leftTop, [right]), true);
  const firstReads = tileReads;
  assert.equal(createPathfindingService(map).isReachable(leftBottom, [right]), true, "multiple actors share the same regions");
  assert.equal(tileReads, firstReads, "a second actor reuses the labels without scanning tiles");
  const door = create(DoorStateSchema, { id: "divide", tiles: [{ x: 1, y: 0 }, { x: 1, y: 1 }] });
  assert.equal(routing.isReachable(leftTop, [right], { doors: [door] }), false);
  door.open = true;
  assert.equal(routing.isReachable(leftTop, [right], { doors: [door] }), true, "opening a door invalidates labels");
  const fixtures = [{ x: 1, y: 0 }, { x: 1, y: 1 }].map((position, index) =>
    create(MapFixtureSchema, { id: `block-${index}`, position }));
  assert.equal(routing.isReachable(leftTop, [right], { doors: [door], fixtures }), false);
  fixtures[1]!.position = undefined;
  assert.equal(routing.isReachable(leftTop, [right], { doors: [door], fixtures }), true, "moving a fixture invalidates labels");
});

test("room constraints and threshold exceptions never bypass physical blockers", () => {
  const routing = createPathfindingService(layout());
  const from = { x: 0, y: 0 }, to = { x: 2, y: 0 };
  assert.equal(routing.findPath(from, to, { allowedRoomIds: ["left"] }), undefined);
  const constraints = { allowedRoomIds: ["left"], thresholds: [to] };
  assert.deepEqual(routing.findPath(from, to, constraints), [from, { x: 1, y: 0 }, to]);
  const door = create(DoorStateSchema, { tiles: [to] });
  assert.equal(routing.findPath(from, to, { ...constraints, doors: [door] }), undefined);
  assert.equal(routing.findPath({ x: -1, y: 0 }, to), undefined);
  assert.equal(routing.isReachable(from, [to], { allowedRoomIds: ["left"] }), false);
  assert.equal(routing.isReachable(from, [to], constraints), true);
  assert.equal(routing.isReachable(from, [to], { ...constraints, doors: [door] }), false);
});
