import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { Client } from "boardgame.io/client";
import { GamePhase } from "../packages/contracts/src/index.js";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";
import { setDoor } from "../packages/core/src/simulation-doors.js";

const setup = () => create(SimulationStateSchema, { map: { phase: GamePhase.CONVERSATIONS,
  actors: [{ characterId: "player", position: { x: 0, y: 0 } },
    { instanceId: "guard-one", characterId: "guard", position: { x: 2, y: 0 } }],
  doors: [{ id: "door", tiles: [{ x: 1, y: 0 }], interactionSpots: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }],
} });

test("player and NPC doors use the same move without mutating prior state", () => {
  const before = setup();
  const opened = executeLocalMove(before, setDoor, "player", "door", true, 1000);
  assert.equal(before.map!.doors[0]!.open, false);
  assert.equal(opened.map!.doors[0]!.open, true);
  assert.equal(opened.map!.revision, 1);
  const client = Client({ game: { setup: () => opened, moves: { setDoor } } });
  client.start();
  client.moves.setDoor!("guard-one", "door", false, 1000);
  assert.equal(client.getState()!.G.map!.doors[0]!.open, false);
  assert.equal(client.getState()!.G.map!.revision, 2);
  client.stop();
});

test("door closure checks interpolated occupancy and rejects invalid actors", () => {
  const G = setup(); G.map!.doors[0]!.open = true;
  G.map!.actors[1]!.movement = { $typeName: "kingmaker.v1.ActorMovement", id: "walk", path: [
    { $typeName: "kingmaker.v1.TilePosition", x: 2, y: 0 },
    { $typeName: "kingmaker.v1.TilePosition", x: 0, y: 0 }], startedAtMs: 1000, durationMs: 200 };
  assert.throws(() => executeLocalMove(G, setDoor, "player", "door", false, 1100), /Invalid/);
  assert.throws(() => executeLocalMove(G, setDoor, "missing", "door", false, 1000), /Invalid/);
  assert.equal(G.map!.doors[0]!.open, true);
});
