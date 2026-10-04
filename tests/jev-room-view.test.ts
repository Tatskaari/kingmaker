import { mockJevChoice } from "./mock-jev.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJson, fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { courtAgentObservation } from "../apps/web/src/court-agent.js";
import { renderJevActionState } from "../apps/web/src/jev-room-view.js";

function game() {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "test");
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

test("Jev always receives the room-scoped text interface and local choices", async t => {
  const local = game(), before = local.snapshot();
  const requests: Array<{ state: any; instructions: any; criteria: Record<string, string> }> = [];
  mockJevChoice(t, async (state: unknown, instructions: unknown, criteria: Record<string, string>) => {
    requests.push({ state, instructions, criteria }); return decision("wait", criteria);
  });
  await local.planNpc("corvin", signal());
  const [experimental] = requests;
  const state = experimental!.state;
  assert.equal(typeof state, "string");
  const headings = ["Who you are:", "Current objective:", "World state:", "Action log ("];
  assert.deepEqual(headings.map(heading => state.indexOf(heading)), headings.map(heading => state.indexOf(heading)).sort((a, b) => a - b));
  assert.ok(state.endsWith("None yet."));
  const scenario = fromJson(ScenarioSchema, local.snapshot().scenario);
  assert.equal(state, renderJevActionState(scenario, courtAgentObservation(scenario, "corvin")));
  assert.equal(typeof experimental!.instructions, "string");
  assert.deepEqual(local.snapshot(), before);
  assert.ok(!experimental!.criteria.move_saltmere_drawing_room);
  assert.ok(experimental!.criteria.enter_royal_council_chamber);
  assert.ok(!experimental!.criteria.enter_treasury, "Closed exit is not selectable");
  assert.match(state, /Great Hall \(current room\)/);
  assert.match(state, /Room connections[\s\S]*Great Hall → [^\n]*Royal Council Chamber/);
  assert.match(state, /Hall sideboard[\s\S]*Contents: Unknown until opened[\s\S]*Open \(illegal\) \[open_palace_hall_cabinet\]/);
  assert.ok(!state.includes("palace_iron_key"), "Concealed contents stay hidden");
  assert.ok(!state.includes("palace_coffer_03"), "Remote furniture stays out of the scene");
  assert.ok(!state.includes('"position"'));
  assert.ok(!state.includes("Biography:") && !state.includes("Notes known to this character:"));
  const offered = [...state.matchAll(/^    - .*\[([^\]]+)\]$/gm)].map(match => match[1]);
  assert.deepEqual(offered.sort(), Object.keys(experimental!.criteria).filter(id => !["complete", "wait", "unable"].includes(id)).sort());
  for (const fork of [local.forkForNpc(), local.forkForResourceReview(async work => work())]) {
    await fork.planNpc("corvin", signal());
    assert.equal(requests.at(-1)!.state, state);
  }
});

test("local plans open, enter, and close a room through real runtime tile steps", async t => {
  const runtime = game();
  const completed: string[] = [];
  for (const id of ["open_treasury_door_0", "enter_treasury", "close_treasury_door_1"]) {
    mockJevChoice(t, async (state: string, _instructions: unknown, criteria: Record<string, string>) => {
      assert.equal(state.split("Action log (completed actions, oldest first):\n")[1], completed.join("\n") || "None yet.");
      assert.ok(id in criteria, `${id} should be offered`); return decision(id, criteria);
    });
    const plan = await runtime.planNpc("corvin", signal());
    let done = false;
    for (let tick = 0; tick < 100; tick++) {
      const step = runtime.stepNpcAction("corvin", id, plan.goal);
      if (step.done) { done = true; break; }
    }
    assert.ok(done, `${id} never completed`);
    completed.push(id);
  }
  const saved = runtime.snapshot(), world = fromJson(ScenarioSchema, saved.scenario).world!;
  assert.equal(world.actors.find(actor => actor.characterId === "corvin")!.roomId, "treasury");
  assert.equal(world.doors.find(door => door.id === "treasury_door")!.open, false);
  assert.equal(saved.npcActivities!.corvin!.history.length, 3);
  assert.deepEqual(saved.npcActivities!.corvin!.actionIds, completed);
  const restored = game(); restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
});

test("concurrent door changes invalidate local travel before the next step", async t => {
  const runtime = game();
  mockJevChoice(t, async (_state: unknown, _instructions: unknown, criteria: Record<string, string>) => decision("enter_royal_council_chamber", criteria));
  const plan = await runtime.planNpc("corvin", signal());
  const snapshot: any = runtime.snapshot();
  snapshot.scenario.world.doors.find((door: any) => door.id === "royal_council_door").open = false;
  runtime.restore(snapshot);
  assert.throws(() => runtime.stepNpcAction("corvin", plan.action!.id, plan.goal), /Action changed; replan/);
});
