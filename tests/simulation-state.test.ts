import assert from "node:assert/strict";
import test from "node:test";
import { fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("simulation can serialize independently of the AI document world", () => {
  const world = loadPlayableWorld(), simulation = world.simulation!;
  const restored = fromBinary(SimulationStateSchema, toBinary(SimulationStateSchema, simulation));
  assert.deepEqual(toJson(SimulationStateSchema, restored), toJson(SimulationStateSchema, simulation));
  assert.ok(restored.map!.actors.some(actor => actor.characterId === "player"));
  assert.ok(Object.keys(restored.runtimeCharacters).length > 0);
  assert.equal("docs" in (toJson(SimulationStateSchema, restored) as object), false);
});

test("pre-simulation saves require a fresh game", () => {
  const host = new WorldHost(loadPlayableWorld());
  const saved = host.snapshot();
  assert.throws(() => host.restore({ ...saved, version: 5 } as unknown as typeof saved), /Start a fresh game/);
});
