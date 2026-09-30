import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJson, fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { ROOM_SCOPED_JEV } from "../apps/web/src/feature-flags.js";
import { GenerationConflict } from "../packages/core/src/generations.js";

function game(roomScoped?: boolean) {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "test", undefined, undefined, undefined, Math.random, roomScoped);
  runtime.createDevelopmentPlayer();
  const snapshot = runtime.snapshot();
  const goal = fromJson(ScenarioSchema, snapshot.scenario).characters.find(item => item.id === "corvin")!.currentGoal;
  snapshot.npcActivities = { corvin: { status: "active", goal, history: [] } };
  runtime.restore(snapshot);
  return runtime;
}
const signal = () => new AbortController().signal;
const decision = (choice: string, criteria: Record<string, string>) => ({ choice,
  probabilities: Object.fromEntries(Object.keys(criteria).map(id => [id, id === choice ? 1 : 0])) });

test("the boolean defaults off; enabling it changes only Jev's view and choices", async t => {
  assert.equal(ROOM_SCOPED_JEV, false);
  const legacy = game(), local = game(true);
  local.restore(legacy.snapshot());
  const requests: Array<{ state: any; instructions: any; criteria: Record<string, string> }> = [];
  t.mock.method(JevClient.prototype, "choose", async (state: unknown, instructions: unknown, criteria: Record<string, string>) => {
    requests.push({ state, instructions, criteria }); return decision("wait", criteria);
  });
  await legacy.planNpc("corvin", signal());
  await local.planNpc("corvin", signal());
  const [baseline, experimental] = requests;
  assert.ok(baseline!.criteria.move_saltmere_drawing_room);
  assert.ok(baseline!.state.generations && baseline!.state.actions);
  assert.ok(baseline!.instructions.privacy);
  assert.equal(experimental!.state.worldView, "room");
  assert.equal(experimental!.state.generations, undefined);
  assert.equal(experimental!.state.actions, undefined);
  assert.equal(experimental!.instructions.privacy, undefined);
  assert.deepEqual(experimental!.state.characterContext, baseline!.state.characterContext);
  assert.deepEqual(local.snapshot(), legacy.snapshot());
  assert.ok(!experimental!.criteria.move_saltmere_drawing_room);
  assert.ok(experimental!.criteria.enter_royal_council_chamber);
  assert.ok(!experimental!.criteria.enter_treasury, "Closed exit is not selectable");
  const world = experimental!.state.world;
  assert.equal(world.rooms.length, 25);
  assert.ok(world.rooms.find((room: any) => room.id === "great_hall").exits.includes("treasury"));
  const sideboard = world.currentRoom.furniture.find((item: any) => item.id === "palace_hall_cabinet");
  assert.equal(sideboard.contents, "Unknown until opened");
  assert.ok(sideboard.actions.find((action: any) => action.id === "open_palace_hall_cabinet").illegal);
  assert.ok(!JSON.stringify(world).includes("palace_iron_key"), "Concealed contents stay hidden");
  assert.ok(!JSON.stringify(world).includes("palace_coffer_03"), "Remote furniture stays out of the scene");
  assert.ok(!JSON.stringify(world).includes('"position"'));
  const offered: string[] = [];
  for (const entries of [world.currentRoom.characters, world.currentRoom.furniture, world.currentRoom.doors, world.currentRoom.exits, world.inventory]) {
    for (const entity of entries) for (const action of entity.actions) offered.push(action.id);
  }
  assert.deepEqual(offered.sort(), Object.keys(experimental!.criteria).filter(id => !["complete", "wait", "unable"].includes(id)).sort());
  assert.equal(local.forkForNpc().roomScopedJev, true);
  assert.equal(local.forkForResourceReview(async work => work()).roomScopedJev, true);
});

test("local plans open, enter, and close a room through real runtime tile steps", async t => {
  const runtime = game(true);
  for (const id of ["open_treasury_door_0", "enter_treasury", "close_treasury_door_1"]) {
    t.mock.method(JevClient.prototype, "choose", async (_state: unknown, _instructions: unknown, criteria: Record<string, string>) => {
      assert.ok(id in criteria, `${id} should be offered`); return decision(id, criteria);
    });
    const plan = await runtime.planNpc("corvin", signal());
    let expected = plan.generations, done = false;
    for (let tick = 0; tick < 100; tick++) {
      const step = runtime.stepNpcAction("corvin", id, plan.goal, expected);
      expected = step.generations;
      if (step.done) { done = true; break; }
    }
    assert.ok(done, `${id} never completed`);
  }
  const saved = runtime.snapshot(), world = fromJson(ScenarioSchema, saved.scenario).world!;
  assert.equal(world.actors.find(actor => actor.characterId === "corvin")!.roomId, "treasury");
  assert.equal(world.doors.find(door => door.id === "treasury_door")!.open, false);
  assert.equal(saved.npcActivities!.corvin!.history.length, 3);
  const restored = game(true); restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
});

test("concurrent door changes invalidate local travel before the next step", async t => {
  const runtime = game(true);
  t.mock.method(JevClient.prototype, "choose", async (_state: unknown, _instructions: unknown, criteria: Record<string, string>) => decision("enter_royal_council_chamber", criteria));
  const plan = await runtime.planNpc("corvin", signal());
  const snapshot: any = runtime.snapshot();
  snapshot.scenario.world.doors.find((door: any) => door.id === "royal_council_door").open = false;
  runtime.restore(snapshot);
  assert.throws(() => runtime.stepNpcAction("corvin", plan.action!.id, plan.goal, plan.generations), GenerationConflict);
});
