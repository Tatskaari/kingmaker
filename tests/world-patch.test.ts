import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJson, fromJsonString, type JsonValue } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { applyWorldPatch, WorldPatchSession } from "../apps/web/src/world-patch.js";

function scenario() {
  const source = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(source, "test");
  runtime.createDevelopmentPlayer();
  return fromJson(ScenarioSchema, runtime.debug().scenario as JsonValue);
}

const gift = {
  id: "aldren_signet", name: "Aldren's signet", locationId: "king", concealed: false,
  properties: { details: "A heavy gold signet bearing the royal seal." },
};

test("one shared world patch can create an item and transfer it to the player", () => {
  const state = scenario(), session = new WorldPatchSession(state);
  assert.equal(applyWorldPatch(state, session, { reason: "Aldren produces his signet.", patch: [
    { op: "add", path: "/world/objectsById/aldren_signet", value: gift },
  ] }).ok, true);
  assert.equal(state.world!.objects.find(item => item.id === gift.id)?.locationId, "king");
  assert.equal(applyWorldPatch(state, session, { reason: "Aldren hands the signet to the player.", patch: [
    { op: "test", path: "/world/objectsById/aldren_signet/locationId", value: "king" },
    { op: "replace", path: "/world/objectsById/aldren_signet/locationId", value: "player" },
  ] }).ok, true);
  assert.equal(state.world!.objects.find(item => item.id === gift.id)?.locationId, "player");
});
test("the RFC 6902 library owns move and copy semantics", () => {
  const state = scenario(), session = new WorldPatchSession(state);
  applyWorldPatch(state, session, { reason: "Create the signet.", patch: [
    { op: "add", path: "/world/objectsById/aldren_signet", value: gift },
  ] });
  assert.equal(applyWorldPatch(state, session, { reason: "Reorganise the signet description.", patch: [
    { op: "copy", from: "/world/objectsById/aldren_signet/name", path: "/world/objectsById/aldren_signet/properties/displayName" },
    { op: "move", from: "/world/objectsById/aldren_signet/properties/details", path: "/world/objectsById/aldren_signet/properties/inscription" },
  ] }).ok, true);
  const properties = state.world!.objects.find(item => item.id === gift.id)!.properties!;
  assert.equal(properties.displayName, gift.name);
  assert.equal(properties.inscription, gift.properties.details);
  assert.equal(properties.details, undefined);
});

test("a world patch validates every operation before committing any change", () => {
  const state = scenario(), session = new WorldPatchSession(state), before = state.premise;
  assert.throws(() => applyWorldPatch(state, session, { reason: "An invalid combined change.", patch: [
    { op: "replace", path: "/premise", value: "This must not commit." },
    { op: "replace", path: "/world/objectsById/missing/locationId", value: "player" },
  ] }), /OPERATION_PATH_UNRESOLVABLE/);
  assert.equal(state.premise, before);
  const doorId = state.world!.doors[0]!.id, roomIds = [...state.world!.doors[0]!.roomIds];
  assert.throws(() => applyWorldPatch(state, session, { reason: "An invalid array insertion.", patch: [
    { op: "add", path: `/world/doorsById/${doorId}/roomIds/999`, value: "great_hall" },
  ] }), /OPERATION_VALUE_OUT_OF_BOUNDS/);
  assert.deepEqual(state.world!.doors.find(door => door.id === doorId)!.roomIds, roomIds);
});

test("semantic conflicts reject the whole patch and return plain current values", () => {
  const state = scenario(), initial = new WorldPatchSession(state);
  applyWorldPatch(state, initial, { reason: "Create the signet.", patch: [
    { op: "add", path: "/world/objectsById/aldren_signet", value: gift },
  ] });
  const stale = new WorldPatchSession(state), concurrent = new WorldPatchSession(state);
  applyWorldPatch(state, concurrent, { reason: "Rook takes custody first.", patch: [
    { op: "replace", path: "/world/objectsById/aldren_signet/locationId", value: "rook" },
    { op: "replace", path: "/premise", value: "The court has concurrently learned a new truth." },
  ] });
  const result = applyWorldPatch(state, stale, { reason: "The stale transfer should fail.", patch: [
    { op: "replace", path: "/world/objectsById/aldren_signet/locationId", value: "player" },
    { op: "replace", path: "/premise", value: "This stale premise must not be written." },
  ] });
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected a conflict");
  assert.equal(result.error, "state_conflict");
  assert.deepEqual(result.current, {
    "/world/objectsById/aldren_signet/locationId": "rook", "/premise": "The court has concurrently learned a new truth.",
  });
  assert.equal(JSON.stringify(result).includes("generation"), false);
  assert.equal(state.world!.objects.find(item => item.id === gift.id)?.locationId, "rook");
});
