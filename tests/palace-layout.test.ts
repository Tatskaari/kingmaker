import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { palaceLayout } from "../apps/web/src/palace-layout.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";
import { courtPath, courtRoomAt } from "../apps/web/src/court-map.js";

const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
const world = scenario.world!;

test("generated floor ownership, access and exits match the authored world", () => {
  for (const room of palaceLayout.worldRooms()) {
    const authored = world.rooms.find(candidate => candidate.id === room.id)!;
    assert.equal(authored.name, room.name);
    assert.equal(authored.private, room.private);
    assert.deepEqual(authored.allowedCharacterIds, room.allowedCharacterIds);
    assert.deepEqual(authored.exitRoomIds, room.exitRoomIds);
  }
  for (const actor of world.actors) assert.equal(courtRoomAt(actor.position!)?.id, actor.roomId, actor.characterId);
  for (const fixture of world.fixtures) {
    assert.equal(courtRoomAt(fixture.position!)?.id, fixture.roomId, fixture.id);
    if (fixture.interactionSpot) assert.equal(courtRoomAt(fixture.interactionSpot)?.id, fixture.roomId, fixture.id);
  }
  for (const door of world.doors) for (const point of [...door.tiles, ...door.interactionSpots]) {
    assert.ok(door.roomIds.includes(courtRoomAt(point)?.id ?? ""), `${door.id} at ${point.x},${point.y}`);
  }
  for (const node of palaceNodes) assert.ok(courtRoomAt(node), node.id);
});

test("two delegations occupy the west wing and Saltmere shares the east with a long dining hall", () => {
  const region = (id: string) => palaceLayout.rooms.find(room => room.id === id)!.regions[0]!;
  const centre = region("great_hall");
  for (const id of ["ironmark_salon", "greenweald_solar"]) {
    assert.ok(region(id).x + region(id).width < centre.x);
    assert.ok(world.rooms.find(room => room.id === "west_wing")!.exitRoomIds.includes(id));
  }
  for (const id of ["saltmere_drawing_room", "dining_hall"]) {
    assert.ok(region(id).x > centre.x + centre.width);
    assert.ok(world.rooms.find(room => room.id === "palace_back_hall")!.exitRoomIds.includes(id));
  }
  const dining = region("dining_hall");
  assert.ok(dining.width >= dining.height * 4);
  const start = palaceNodes.find(node => node.id === "great_hall")!;
  for (const id of ["ironmark_salon", "greenweald_solar", "saltmere_drawing_room", "dining_hall"]) {
    assert.ok(courtPath(start, palaceNodes.find(node => node.id === id)!, world.doors, world.fixtures), id);
  }
});
