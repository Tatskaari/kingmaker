import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromJsonString } from "@bufbuild/protobuf";
import { ActiveObjectiveSchema, NoteSchema, NoteVisibility, ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import type { JevActionContextOptions } from "../apps/web/src/jev-room-view.js";

function game(options: JevActionContextOptions = {}, roomScoped = true) {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const king = scenario.characters.find(item => item.id === "king")!;
  scenario.premise = "PREMISE_SENTINEL";
  king.lore = "BIOGRAPHY_SENTINEL";
  king.currentGoal = "TASK_SENTINEL";
  king.activeObjective = create(ActiveObjectiveSchema, { name: "OBJECTIVE_SENTINEL", status: "STATUS_SENTINEL",
    successCriteria: "SUCCESS_SENTINEL", currentGoal: king.currentGoal });
  king.parkedObjectives = [create(ActiveObjectiveSchema, { name: "PARKED_SENTINEL", status: "PARKED_STATUS_SENTINEL", successCriteria: "PARKED_SUCCESS_SENTINEL", currentGoal: "PARKED_TASK_SENTINEL" })];
  king.relationships[0]!.description = "RELATIONSHIP_SENTINEL";
  scenario.notes.push(create(NoteSchema, { id: "visible", text: "VISIBLE_NOTE_SENTINEL", characterIds: ["king"], visibility: NoteVisibility.PRIVATE }),
    create(NoteSchema, { id: "hidden", text: "HIDDEN_NOTE_SENTINEL", characterIds: ["corvin"], visibility: NoteVisibility.PRIVATE }));
  const runtime = new BrowserGameRuntime(scenario, "test", undefined, undefined, undefined, () => 0, roomScoped, options);
  runtime.createDevelopmentPlayer();
  const snapshot = runtime.snapshot();
  snapshot.npcActivities = { king: { status: "active", goal: king.currentGoal, history: ["RECENT_RESULT_SENTINEL"] } };
  runtime.restore(snapshot);
  return runtime;
}
const signal = () => new AbortController().signal;

test("action context tiers send exactly their selected facts as text", async t => {
  let captured = "", state = "";
  t.mock.method(JevClient.prototype, "choose", async (input: unknown, instructions: unknown, criteria: Record<string, string>) => {
    assert.equal(typeof input, "string"); state = input as string;
    captured = JSON.stringify({ state, instructions, criteria });
    return { choice: "wait", probabilities: {} };
  });
  for (const level of [1, 2, 3] as const) {
    const runtime = game({ level });
    await runtime.planNpc("king", signal());
    for (const fact of ["OBJECTIVE_SENTINEL", "STATUS_SENTINEL", "SUCCESS_SENTINEL", "TASK_SENTINEL"]) assert.ok(state.includes(fact));
    for (const fact of ["BIOGRAPHY_SENTINEL", "PARKED_SENTINEL", "PARKED_STATUS_SENTINEL", "PARKED_SUCCESS_SENTINEL", "PARKED_TASK_SENTINEL"]) assert.equal(captured.includes(fact), level >= 2, fact);
    for (const fact of ["RELATIONSHIP_SENTINEL", "VISIBLE_NOTE_SENTINEL"]) assert.equal(captured.includes(fact), level >= 3, fact);
    for (const fact of ["PREMISE_SENTINEL", "HIDDEN_NOTE_SENTINEL", "RECENT_RESULT_SENTINEL"]) assert.ok(!captured.includes(fact), fact);
    assert.deepEqual(runtime.forkForNpc().jevActionContext, { level });
    assert.deepEqual(runtime.forkForResourceReview(async work => work()).jevActionContext, { level });
  }
  await game({ level: 1, includeRecentResults: true }).planNpc("king", signal());
  assert.match(state, /Recent action results[\s\S]*RECENT_RESULT_SENTINEL/);
  assert.ok(!state.includes("BIOGRAPHY_SENTINEL"));
});

test("action flags leave event-reaction Jev and dialogue inputs unchanged", async t => {
  const baseline = game({}, false), experimental = game({ level: 1, includeRecentResults: true });
  experimental.restore(baseline.snapshot());
  let decisions: unknown[] = [];
  t.mock.method(JevClient.prototype, "choose", async (state: unknown, instructions: unknown, criteria: Record<string, string>) => {
    decisions.push({ state, instructions, criteria }); return { choice: "ignore", probabilities: {} };
  });
  const event = baseline.worldEvent("door", "The king opened a door.", ["king"]);
  await baseline.assessWorldEvent(event, signal());
  const originalDecisions = decisions; decisions = [];
  await experimental.assessWorldEvent(event, signal());
  assert.ok(originalDecisions.length > 0);
  assert.deepEqual(decisions, originalDecisions);
  const dialogueRequests: unknown[] = [];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: unknown) => {
    dialogueRequests.push(request);
    return { role: "assistant", content: JSON.stringify({ utterance: "Welcome.", replyOptions: [], endConversation: false }) };
  });
  await baseline.talkToCharacter("king", "Hello");
  await experimental.talkToCharacter("king", "Hello");
  assert.equal(dialogueRequests.length, 2);
  assert.deepEqual(dialogueRequests[1], dialogueRequests[0]);
});
