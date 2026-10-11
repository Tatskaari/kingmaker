import { roomAgentActions } from "../apps/web/src/room-actions.js";
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
  assert.match(locations, /Marshal Garran Holt \(holt\): Entrance Hall \(walk via enter_royal_council_chamber, enter_great_hall, enter_entrance_hall\)/);
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

test("instance identities remain separate and maps may be unavailable", () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const guards = map.actors.filter(actor => actor.characterId.startsWith("palace-guard-"));
  assert.ok(guards.length > 1);
  const first = guards[0]!, second = guards[1]!;
  const locations = activityNpcLocations(world, first.instanceId!);
  assert.ok(!locations.includes(`(${first.instanceId})`));
  assert.ok(locations.includes(`(${second.instanceId})`));
  world.simulation!.map = undefined;
  assert.match(activityNpcLocations(world, "aldren"), /no current map/);
});


test("the emitted multi-room route resolves to executable room actions", () => {
  const world = loadPlayableWorld(), map = world.simulation!.map!;
  const actor = map.actors.find(actor => actor.characterId === "aldren")!;
  actor.roomId = "north_corridor";
  Object.assign(actor.position!, { x: 61, y: 12 });
  for (const door of map.doors) door.open = true;
  const line = activityNpcLocations(world, "aldren").split("\n").find(line => line.includes("(holt)"))!;
  const steps = line.match(/enter_[a-z_]+/g)!;
  assert.ok(steps.length > 1);
  for (const step of steps) {
    const action = roomAgentActions(map, [], [], "aldren", step).find(action => action.id === step);
    assert.ok(action?.path.length, step);
    Object.assign(actor.position!, action.path.at(-1));
    actor.roomId = action.target;
  }
  assert.equal(actor.roomId, map.actors.find(actor => actor.characterId === "holt")!.roomId);
});
