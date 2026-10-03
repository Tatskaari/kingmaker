import { inventoryOwners } from "../packages/core/src/inventory.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema, TilePositionSchema, type Scenario } from "../packages/contracts/src/index.js";
import { roomAgentActions } from "../apps/web/src/room-actions.js";
import { courtRoomAt } from "../apps/web/src/court-map.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";
import { applyFixtureAction } from "../packages/core/src/fixtures.js";

const load = () => fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
test("Sabine must visit and open her writing table to check the dispatch ledger", () => {
  const scenario = load(), actor = scenario.world!.actors.find(item => item.characterId === "sabine")!;
  const inspect = "inspect_item_furn_sabine_dispatch_ledger";
  actor.roomId = "great_hall";
  actor.position = create(TilePositionSchema, scenario.courtArrivalPlacements.find(item => item.characterId === "sabine")!.position!);
  assert.ok(!roomAgentActions(scenario, "sabine").some(action => action.id === inspect));
  actor.roomId = "sabine_chamber";
  actor.position = create(TilePositionSchema, scenario.world!.fixtures.find(item => item.id === "furn_sabine_desk")!.interactionSpot!);
  assert.ok(!roomAgentActions(scenario, "sabine").some(action => action.id === inspect));
  const open = roomAgentActions(scenario, "sabine").find(action => action.id === "open_furn_sabine_desk")!;
  assert.equal(open.legality, "normal");
  applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "sabine", open.id);
  assert.ok(roomAgentActions(scenario, "sabine").some(action => action.id === inspect));
  assert.match(applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "sabine", inspect), /no Grey Gull booking/);
});

function place(scenario: Scenario, roomId: string) {
  const actor = scenario.world!.actors.find(item => item.characterId === "corvin")!;
  actor.roomId = roomId;
  actor.position = create(TilePositionSchema, palaceNodes.find(node => courtRoomAt(node)?.id === roomId)!);
  return actor;
}

test("room actions offer adjacent travel and local interactions, even with every door open", () => {
  const scenario = load(), world = scenario.world!;
  place(scenario, "great_hall");
  for (const door of world.doors) door.open = true;
  const king = world.actors.find(actor => actor.characterId === "king")!;
  king.roomId = "great_hall"; king.awake = true; king.position = create(TilePositionSchema, { x: 62, y: 23 });
  const actions = roomAgentActions(scenario, "corvin");
  assert.ok(actions.some(action => action.id === "talk_king"));
  assert.ok(!actions.some(action => action.id === "talk_garran"));
  assert.ok(!actions.some(action => action.target === "palace_corvin_drawers" || action.target === "corvin_door"));
  assert.equal(actions.find(action => action.id === "open_palace_hall_cabinet")?.legality, "illegal");
  assert.equal(actions.find(action => action.id === "inspect_palace_hall_cabinet")?.legality, "normal");
  const moves = actions.filter(action => action.type === "move");
  assert.deepEqual(moves.map(action => action.target).sort(), [...world.rooms.find(room => room.id === "great_hall")!.exitRoomIds].sort());
  for (const action of moves) assert.ok(action.path.every(point => ["great_hall", action.target].includes(courtRoomAt(point)!.id)));
});

test("every authored adjacent room remains reachable through repeated tile steps", () => {
  const scenario = load(), world = scenario.world!;
  for (const door of world.doors) door.open = true;
  for (const room of world.rooms) for (const nextRoom of room.exitRoomIds) {
    const actor = place(scenario, room.id), id = `enter_${nextRoom}`;
    let arrived = false;
    for (let tick = 0; tick < 200; tick++) {
      const action = roomAgentActions(scenario, "corvin", tick ? id : undefined).find(action => action.id === id);
      assert.ok(action, `${room.id} → ${nextRoom} lost its action at ${JSON.stringify(actor.position)}`);
      const next = action.path[1] ?? action.path[0]!;
      actor.position = create(TilePositionSchema, next); actor.roomId = courtRoomAt(next)!.id;
      if (action.path.length <= 2) { arrived = true; break; }
    }
    assert.ok(arrived, `${id} did not finish`);
    assert.equal(actor.roomId, nextRoom);
    assert.ok(!roomAgentActions(scenario, "corvin").some(action => action.id === id), "Arrival removes the completed travel choice");
  }
});

test("closed exits require opening and only the near side of an open door is offered", () => {
  const scenario = load(), world = scenario.world!;
  place(scenario, "great_hall");
  const door = world.doors.find(item => item.id === "treasury_door")!;
  door.open = false;
  let actions = roomAgentActions(scenario, "corvin");
  assert.ok(!actions.some(action => action.id === "enter_treasury"));
  assert.ok(actions.some(action => action.id === "open_treasury_door_0"));
  door.open = true;
  actions = roomAgentActions(scenario, "corvin");
  assert.ok(actions.some(action => action.id === "enter_treasury"));
  assert.ok(actions.some(action => action.id === "close_treasury_door_0"));
  assert.ok(!actions.some(action => action.id === "close_treasury_door_1"));
  place(scenario, "treasury");
  actions = roomAgentActions(scenario, "corvin");
  assert.ok(actions.some(action => action.id === "close_treasury_door_1"));
  assert.ok(!actions.some(action => action.id === "close_treasury_door_0"));
});

test("door approaches on adjoining threshold tiles remain executable", () => {
  const scenario = load(), world = scenario.world!;
  for (const door of world.doors) for (const [side, roomId] of door.roomIds.entries()) {
    for (const other of world.doors) other.open = true;
    door.open = false;
    const actor = place(scenario, roomId), id = `open_${door.id}_${side}`;
    for (let tick = 0; tick < 200; tick++) {
      const action = roomAgentActions(scenario, "corvin", id).find(action => action.id === id);
      assert.ok(action, `${id} unavailable from ${roomId} at ${JSON.stringify(actor.position)}`);
      if (action.path.length <= 2) break;
      actor.position = create(TilePositionSchema, action.path[1]!); actor.roomId = courtRoomAt(actor.position)!.id;
      assert.ok(tick < 199, `${id} did not finish`);
    }
  }
});
