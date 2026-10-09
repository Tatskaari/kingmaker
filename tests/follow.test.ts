import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { followRoute } from "../packages/core/src/follow.js";

function fixture() {
  return create(SimulationStateSchema, { map: {
    rooms: [{ id: "hall" }, { id: "private", private: true, allowedCharacterIds: ["player"] }],
    layout: { width: 8, height: 3, tiles: Array.from({ length: 24 }, () => ({ layers: [{ solid: false }] })),
      rooms: [{ id: "hall", regions: [{ x: 0, y: 0, width: 5, height: 3 }] },
        { id: "private", regions: [{ x: 5, y: 0, width: 3, height: 3 }] }] },
    actors: [{ characterId: "rowan", roomId: "hall", awake: true, position: { x: 0, y: 1 } },
      { characterId: "player", roomId: "hall", awake: true, position: { x: 4, y: 1 } }],
  } });
}
test("following selects a free adjacent tile and settles there without another move", () => {
  const G = fixture(), route = followRoute(G, "rowan", "player", 0)!;
  assert.deepEqual(route.path.at(-1), { x: 3, y: 1 });
  G.map!.actors[0]!.position = { ...G.map!.actors[0]!.position!, x: 3 };
  assert.equal(followRoute(G, "rowan", "player", 0)!.path.length, 1);
});
test("following respects access and closed doors rather than teleporting", () => {
  const G = fixture();
  G.map!.actors[1]!.position!.x = 6;
  assert.equal(followRoute(G, "rowan", "player", 0), undefined);
  G.map!.rooms[1]!.allowedCharacterIds.push("rowan");
  assert.ok(followRoute(G, "rowan", "player", 0));
  G.map!.doors.push({ $typeName: "kingmaker.v1.DoorState", id: "door", name: "Door", open: false,
    roomIds: ["hall", "private"], tiles: [0, 1, 2].map(y => ({ $typeName: "kingmaker.v1.TilePosition", x: 5, y })), interactionSpots: [] });
  assert.equal(followRoute(G, "rowan", "player", 0), undefined);
});
test("following tracks interpolated positions and rejects self or missing targets", () => {
  const G = fixture(), player = G.map!.actors[1]!;
  player.movement = { $typeName: "kingmaker.v1.ActorMovement", id: "walk", startedAtMs: 0, durationMs: 200,
    path: [4, 3, 2].map(x => ({ $typeName: "kingmaker.v1.TilePosition", x, y: 1 })) };
  assert.deepEqual(followRoute(G, "rowan", "player", 200)!.path.at(-1), { x: 1, y: 1 });
  assert.equal(followRoute(G, "rowan", "rowan", 0), undefined);
  assert.equal(followRoute(G, "rowan", "missing", 0), undefined);
});
