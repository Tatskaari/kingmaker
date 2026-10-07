import { create } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import test from "node:test";
import { courtRoomAt } from "../apps/web/src/court-navigation.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";
import { roomAgentActions } from "../apps/web/src/room-actions.js";
import { TilePositionSchema } from "../packages/contracts/src/index.js";
import { applyFixtureAction } from "../packages/core/src/fixtures.js";
import { inventoryOwners } from "../packages/core/src/inventory.js";
import { physicalFixture } from "./fixtures.js";

const load = physicalFixture;
test("Sabine must visit and open her writing table to check the dispatch ledger", () => {
  const scenario = load(), actor = scenario.world!.actors.find(item => item.characterId === "cressida")!;
  const inspect = "inspect_item_furn_sabine_dispatch_ledger";
  actor.roomId = "great_hall";
  actor.position = create(TilePositionSchema, { x: 61, y: 24 });
  assert.ok(!roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "cressida").some(action => action.id === inspect));
  actor.roomId = "sabine_chamber";
  actor.position = create(TilePositionSchema, scenario.world!.fixtures.find(item => item.id === "furn_sabine_desk")!.interactionSpot!);
  assert.ok(!roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "cressida").some(action => action.id === inspect));
  const open = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "cressida").find(action => action.id === "open_furn_sabine_desk")!;
  assert.equal(open.legality, "normal");
  applyFixtureAction(scenario.source.simulation!, "cressida", open.id);
  assert.ok(roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "cressida").some(action => action.id === inspect));
  assert.match(applyFixtureAction(scenario.source.simulation!, "cressida", inspect), /no Grey Gull booking/);
});

function place(scenario: ReturnType<typeof load>, roomId: string) {
  const actor = scenario.world!.actors.find(item => item.characterId === "corvin")!;
  actor.roomId = roomId;
  actor.position = create(TilePositionSchema, palaceNodes.find(node => courtRoomAt(node)?.id === roomId)!);
  return actor;
}

test("room actions offer adjacent travel and local interactions, even with every door open", () => {
  const scenario = load(), world = scenario.world!;
  place(scenario, "great_hall");
  for (const door of world.doors) door.open = true;
  const holt = world.actors.find(actor => actor.characterId === "holt")!;
  holt.roomId = "garran_chamber"; holt.position = create(TilePositionSchema, { x: 72, y: 5 });
  const king = world.actors.find(actor => actor.characterId === "aldren")!;
  king.roomId = "great_hall"; king.awake = true; king.position = create(TilePositionSchema, { x: 62, y: 23 });
  const actions = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin");
  assert.ok(actions.some(action => action.id === "talk_aldren"));
  assert.ok(!actions.some(action => action.id === "talk_holt"));
  assert.ok(!actions.some(action => action.target === "palace_corvin_drawers" || action.target === "corvin_door"));
  assert.equal(actions.find(action => action.id === "open_palace_hall_cabinet")?.legality, "illegal");
  assert.equal(actions.find(action => action.id === "inspect_palace_hall_cabinet")?.legality, "normal");
  const moves = actions.filter(action => action.type === "move");
  assert.deepEqual(moves.map(action => action.target).sort(), [...world.rooms.find(room => room.id === "great_hall")!.exitRoomIds].sort());
  for (const choice of moves) {
    const action = roomAgentActions(world, scenario.characters, inventoryOwners(scenario.characters, world), "corvin", choice.id)[0]!;
    assert.ok(action.path.length);
    assert.ok(action.path.every(point => ["great_hall", action.target].includes(courtRoomAt(point)!.id)));
  }
});

test("every authored adjacent room remains reachable through repeated tile steps", () => {
  const scenario = load(), world = scenario.world!;
  for (const door of world.doors) door.open = true;
  for (const room of world.rooms) for (const nextRoom of room.exitRoomIds) {
    const actor = place(scenario, room.id), id = `enter_${nextRoom}`;
    let arrived = false;
    for (let tick = 0; tick < 200; tick++) {
      const action = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin", id).find(action => action.id === id);
      assert.ok(action, `${room.id} → ${nextRoom} lost its action at ${JSON.stringify(actor.position)}`);
      const next = action.path[1] ?? action.path[0]!;
      actor.position = create(TilePositionSchema, next); actor.roomId = courtRoomAt(next)!.id;
      if (action.path.length <= 2) { arrived = true; break; }
    }
    assert.ok(arrived, `${id} did not finish`);
    assert.equal(actor.roomId, nextRoom);
    assert.ok(!roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin").some(action => action.id === id), "Arrival removes the completed travel choice");
  }
});

test("closed exits require opening and only the near side of an open door is offered", () => {
  const scenario = load(), world = scenario.world!;
  place(scenario, "great_hall");
  const door = world.doors.find(item => item.id === "treasury_door")!;
  door.open = false;
  let actions = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin");
  assert.ok(!actions.some(action => action.id === "enter_treasury"));
  assert.ok(actions.some(action => action.id === "open_treasury_door_0"));
  door.open = true;
  actions = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin");
  assert.ok(actions.some(action => action.id === "enter_treasury"));
  assert.ok(actions.some(action => action.id === "close_treasury_door_0"));
  assert.ok(!actions.some(action => action.id === "close_treasury_door_1"));
  place(scenario, "treasury");
  actions = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin");
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
      const action = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), "corvin", id).find(action => action.id === id);
      assert.ok(action, `${id} unavailable from ${roomId} at ${JSON.stringify(actor.position)}`);
      if (action.path.length <= 2) break;
      actor.position = create(TilePositionSchema, action.path[1]!); actor.roomId = courtRoomAt(actor.position)!.id;
      assert.ok(tick < 199, `${id} did not finish`);
    }
  }
});

test("action discovery estimates Manhattan distances without reading tiles", () => {
  const scenario = load(), world = scenario.world!;
  place(scenario, "great_hall");
  Object.defineProperty(world.layout!, "tiles", { get() { throw new Error("Discovery must not pathfind"); } });
  const actions = roomAgentActions(world, scenario.characters, inventoryOwners(scenario.characters, world), "corvin");
  assert.ok(actions.some(action => action.type === "talk"));
  assert.ok(actions.some(action => action.type === "fixture"));
  assert.ok(actions.some(action => action.type === "door"));
  assert.ok(actions.every(action => action.path.length === 0 && Number.isFinite(action.estimatedSteps)));
  const actor = world.actors.find(item => item.characterId === "corvin")!;
  const king = world.actors.find(item => item.characterId === "aldren")!;
  const distance = Math.abs(actor.position!.x - king.position!.x) + Math.abs(actor.position!.y - king.position!.y);
  assert.equal(actions.find(action => action.id === "talk_aldren")!.estimatedSteps, Math.max(0, distance - 1));
});
