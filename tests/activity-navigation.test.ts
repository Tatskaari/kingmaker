import assert from "node:assert/strict";
import test from "node:test";
import { activityNpcLocations } from "../packages/conversation/src/activity-navigation.js";
import { loadPlayableWorld } from "./fixtures.js";

test("live NPC locations use ordered room entries with doors assumed open", () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const actor = map.actors.find(actor => actor.characterId === "aldren")!;
  actor.roomId = "north_corridor";
  for (const door of map.doors) door.open = false;
  const locations = activityNpcLocations(world, "aldren");
  assert.match(locations, /Marshal Garran Holt \(holt\): Entrance Hall \(walk via enter_great_hall, enter_entrance_hall\)/);
  assert.ok(!locations.includes("King Aldren (aldren)"));
  assert.ok(!locations.includes("(player)"));
  assert.ok(map.doors.every(door => !door.open), "Planning must not open doors");
  assert.equal(actor.roomId, "north_corridor");
});

test("locations refresh and distinguish same-room, disconnected and unknown origins", () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const actor = map.actors.find(actor => actor.characterId === "aldren")!;
  const holt = map.actors.find(actor => actor.characterId === "holt")!;
  holt.roomId = actor.roomId;
  assert.match(activityNpcLocations(world, "aldren"), /Holt \(holt\): Great Hall \(already in your room\)/);
  holt.roomId = "entrance_hall";
  map.rooms.find(room => room.id === actor.roomId)!.exitRoomIds = [];
  assert.match(activityNpcLocations(world, "aldren"), /Holt \(holt\): Entrance Hall \(no connected room route\)/);
  actor.roomId = "missing";
  assert.match(activityNpcLocations(world, "aldren"), /route unavailable: origin unknown/);
  holt.roomId = "missing";
  assert.match(activityNpcLocations(world, "aldren"), /Holt \(holt\): Unknown room \(location unavailable\)/);
});
