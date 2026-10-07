import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { MapStateSchema } from "../packages/contracts/src/index.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { palaceMap } from "../apps/web/src/palace-map.js";
import { worldForCharacter, worldViewJson } from "../packages/core/src/physical-view.js";
import { loadPlayableWorld } from "./fixtures.js";

test("MapState serializes tile layout alongside physical actors and obstacles", () => {
  const map = create(MapStateSchema, { layout: { width: 1, height: 1,
    tiles: [{ layers: [{ solid: true }] }] }, actors: [{ characterId: "guard" }], doors: [{ id: "door" }] });
  assert.deepEqual(fromBinary(MapStateSchema, toBinary(MapStateSchema, map)), map);
  assert.equal("layout" in worldViewJson(worldForCharacter(map, [], "guard")), false);
});

test("map service reads saved simulation layout and returns detached data", () => {
  const source = loadPlayableWorld(), map = source.simulation!.map!;
  assert.deepEqual(map.layout, palaceMap);
  map.layout!.name = "Saved tile layout";
  assert.notEqual(palaceMap.name, map.layout!.name, "fresh games own their layout");
  const host = new WorldHost(source);
  const returned = host.map.layout();
  returned.name = "Modified read";
  assert.equal(host.world().simulation!.map!.layout!.name, "Saved tile layout");
  host.restore(host.snapshot());
  assert.equal(host.map.layout().name, "Saved tile layout");
});
