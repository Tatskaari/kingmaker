import assert from "node:assert/strict";
import test from "node:test";
import { fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { playableWorld } from "../apps/web/src/playable-world.js";
import { loadDocumentLayers } from "../packages/service-tools/src/layered-docs.js";
import palace from "../content/palace-map.json" with { type: "json" };

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

test("characters sharing AI lore own independent sheets and inventories", () => {
  const { markdown, sidecars } = loadDocumentLayers(["lore"]);
  sidecars.set("Scenarios/Centennial Assembly/Characters/palace-guard/properties.json", {
    dnd: { hitPoints: { current: 10, maximum: 10 } }, inventory: { items: [] },
  });
  const world = playableWorld(fromJson(MapSchema, palace), markdown, sidecars);
  const guards = Object.values(world.simulation!.runtimeCharacters).filter(actor => actor.characterId === "palace-guard");
  const first = guards[0]!, second = guards[1]!;
  assert.equal(first.document, second.document);
  assert.ok(first.dnd && first.inventory && second.dnd && second.inventory);
  assert.notStrictEqual(first.dnd, second.dnd);
  assert.notStrictEqual(first.inventory, second.inventory);
  const health = second.dnd.hitPoints!.current, count = second.inventory.items.length;
  first.dnd.hitPoints!.current = 0;
  first.inventory.items.length = 0;
  assert.equal(second.dnd.hitPoints!.current, health);
  assert.equal(second.inventory.items.length, count);
  assert.ok(Object.values(world.docs).every(document => !("characterProperties" in document)));
});
