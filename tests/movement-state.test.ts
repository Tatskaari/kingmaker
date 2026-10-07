import { create, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";

test("movement records and fractional positions survive binary and JSON persistence", () => {
  const state = create(SimulationStateSchema, { map: { actors: [{
    instanceId: "guard-1", characterId: "guard", position: { x: 2.25, y: 4 },
    movement: { id: "walk-1", path: [{ x: 2.25, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 5 }],
      startedAtMs: 1700000000123, durationMs: 175 },
  }, { instanceId: "guard-2", characterId: "guard", position: { x: 8, y: 4 } }] } });
  const binary = fromBinary(SimulationStateSchema, toBinary(SimulationStateSchema, state));
  const json = fromJson(SimulationStateSchema, toJson(SimulationStateSchema, state));
  for (const restored of [binary, json]) {
    assert.deepEqual(restored, state);
    assert.equal(restored.map!.actors[0]!.position!.x, 2.25);
    assert.equal(restored.map!.actors[0]!.movement!.path[0]!.x, 2.25);
    assert.equal(restored.map!.actors[1]!.movement, undefined);
  }
});
