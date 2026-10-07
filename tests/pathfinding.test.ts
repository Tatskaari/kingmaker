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

test("room constraints and threshold exceptions never bypass physical blockers", () => {
  const routing = createPathfindingService(layout());
  const from = { x: 0, y: 0 }, to = { x: 2, y: 0 };
  assert.equal(routing.findPath(from, to, { allowedRoomIds: ["left"] }), undefined);
  const constraints = { allowedRoomIds: ["left"], thresholds: [to] };
  assert.deepEqual(routing.findPath(from, to, constraints), [from, { x: 1, y: 0 }, to]);
  const door = create(DoorStateSchema, { tiles: [to] });
  assert.equal(routing.findPath(from, to, { ...constraints, doors: [door] }), undefined);
  assert.equal(routing.findPath({ x: -1, y: 0 }, to), undefined);
});
