import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { resourceReviewTools, type ResourceReviewContext } from "../apps/web/src/resource-review.js";
import { ACTIVE_OBJECTIVE_GUIDANCE } from "../apps/web/src/objectives.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";

const context: ResourceReviewContext = { kind: "conversation_review", participants: ["corvin"], allowNextGoal: true };
const changes = { append_notes: [], relationships: [] };
function game() {
  const runtime = new BrowserGameRuntime(fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "test");
  runtime.createDevelopmentPlayer(); return runtime;
}
const objective = { action: "set", name: "Gather the court", status: "Garran agreed. Invite Lucan, then verify arrivals.",
  success_criteria: "All delegates are in the Treasury ready to listen.", current_goal: "Talk to Lucan", reason: "Accepted the request" };
const characterState = (runtime: BrowserGameRuntime) => (runtime.readResources(["character:corvin"])["character:corvin"]!.state as any);
function objectiveWrite(runtime: BrowserGameRuntime, change: unknown) {
  return runtime.applyResourceReviewWrite("update_character", { character_id: "corvin",
    changes: { active_objective: change } }, context);
}

test("objective plan and goal commit together and survive saves", () => {
  const runtime = game();
  objectiveWrite(runtime, objective);
  assert.equal(characterState(runtime).character.activeObjective.currentGoal, "Talk to Lucan");
  const saved = runtime.snapshot();
  const restored = game(); restored.restore(saved);
  assert.equal(characterState(restored).character.activeObjective.status, objective.status);
  assert.ok(runtime.hasActiveObjective("corvin"));
  assert.throws(() => objectiveWrite(runtime, { ...objective, status: "" }), /status/);
  assert.throws(() => runtime.applyResourceReviewWrite("update_character", {
    character_id: "corvin", changes: { current_goal: null },
  }, context), /active_objective/);
  objectiveWrite(runtime, { action: "demote", reason: "No reachable willing delegates; defer." });
  assert.equal(runtime.hasActiveObjective("corvin"), false);
  assert.ok(characterState(runtime).character.parkedObjectives.some((item: any) => item.name === objective.name));
  assert.equal(characterState(runtime).activity.status, "idle");
});

test("conversation review can revise and clear dialogue objectives without creating planner work", () => {
  const runtime = game();
  const originalGoal = characterState(runtime).character.currentGoal;
  const revised = "Ask the player what they learned from the sealed patrol records.";
  const first = runtime.applyResourceReviewWrite("update_character", {
    character_id: "corvin",
    changes: { dialogue_objectives: [revised, "Warn the player that Corvin will require authenticated evidence."] },
  }, context) as any;
  assert.equal(first.commit_result, "success");
  assert.deepEqual(characterState(runtime).character.dialogueObjectives, [revised, "Warn the player that Corvin will require authenticated evidence."]);
  assert.equal(characterState(runtime).character.currentGoal, originalGoal);

  const cleared = runtime.applyResourceReviewWrite("update_character", {
    character_id: "corvin",
    changes: { dialogue_objectives: [] },
  }, context) as any;
  assert.equal(cleared.commit_result, "success");
  assert.deepEqual(characterState(runtime).character.dialogueObjectives, []);
  assert.equal(characterState(runtime).character.currentGoal, originalGoal);
  assert.equal(characterState(runtime).activity, null);
});

test("outcome review must continue or resolve an active objective, even after a run budget", async t => {
  const runtime = game();
  objectiveWrite(runtime, objective);
  runtime.finishNpcRun("corvin", "complete", "Lucan agreed to attend; others still need invitations.");
  const fork = runtime.forkForResourceReview(synchronousCommit);
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
    calls++;
    if (calls === 1) {
      assert.ok(input.messages.some((m: any) => m.content?.includes("Completing a step")));
      return call("finish_review", { summary: "Done with Lucan" });
    }
    if (calls === 2) {
      assert.match(JSON.parse(input.messages.at(-1).content).reason, /next goal/);
      return call("update_character", { character_id: "corvin",
        changes: { active_objective: { ...objective, status: "Lucan agreed, but has not arrived. Invite Mara next; then verify arrivals.",
          current_goal: "Talk to Mara", reason: "The invitation step succeeded, the gathering is unfinished." } } });
    }
    return call("finish_review", { summary: "Continue inviting delegates." });
  });
  await fork.reviewNpcOutcome("corvin", false);
  assert.equal(calls, 3);
  assert.equal(characterState(runtime).character.currentGoal, "Talk to Mara");
  assert.equal(characterState(runtime).character.activeObjective.successCriteria, objective.success_criteria);
  assert.equal(characterState(runtime).activity.status, "active");
  assert.equal(characterState(runtime).activity.reviewPending, false);
});

test("resource tools hide generation IDs and expose one shared world patch", () => {
  const tools = resourceReviewTools();
  assert.ok(!tools.some(t => t.function.name === "commit_review"));
  const patch = tools.find(t => t.function.name === "patch_world_state")!;
  assert.ok(patch);
  assert.match(JSON.stringify(patch.function.parameters), /"move"/);
  assert.match(JSON.stringify(patch.function.parameters), /"copy"/);
  assert.equal(JSON.stringify(tools).includes("generation"), false);
});

test("character writes return fresh plain state on semantic conflict", () => {
  const runtime = game();
  const initial = structuredClone(characterState(runtime));
  const observed = { "character:corvin": initial };
  const first = runtime.applySemanticResourceReviewWrite("update_character", { character_id: "corvin",
    changes: { ...changes, lore: "A revised biography." } }, context, observed);
  assert.equal(first.commit_result, "success");
  const before = runtime.snapshot();
  const stale = runtime.applySemanticResourceReviewWrite("update_character", { character_id: "corvin",
    changes: { ...changes, lore: "An obsolete biography." } }, context, { "character:corvin": initial }) as any;
  assert.equal(stale.error, "state_conflict");
  assert.equal((stale.current as any).character.lore, "A revised biography.");
  assert.deepEqual(runtime.snapshot(), before);
});

test("inventory additions validate atomically without generation IDs", () => {
  const runtime = game();
  const item = { id: "review_note", name: "Note", details: "A written agreement.", reason: "A justified prop." };
  const before = runtime.snapshot();
  assert.throws(() => runtime.applyResourceReviewWrite("update_inventory", { owner_id: "corvin", add_items: [item, item] }, context), /already exists/);
  assert.deepEqual(runtime.snapshot(), before);
  const result = runtime.applyResourceReviewWrite("update_inventory", { owner_id: "corvin", add_items: [item] }, context);
  assert.equal(result.commit_result, "success");
  assert.equal((result.new_state.data as unknown[]).length, 1);
});

test("character reviews can revise passive objectives without activating them", () => {
  const runtime = game();
  const result = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", changes: {
    parked_objectives: [{ action: "set", reason: "A perceived event made this relevant later.", name: "Watch the treasury",
      status: "The treasury door was opened; investigate after the current duty.", success_criteria: "The reason for the opening is known.", current_goal: "Inspect the treasury." }],
  } }, context);
  assert.equal(result.commit_result, "success");
  assert.ok((result.new_state.data as any).character.parkedObjectives.some((objective: any) => objective.name === "Watch the treasury"));
  assert.notEqual((result.new_state.data as any).character.activeObjective.name, "Watch the treasury");
});

test("omitted fields preserve objectives and relationships; an objective transition makes the NPC idle", () => {
  const runtime = game();
  const initial = runtime.readResources(["character:corvin"])["character:corvin"]!.state as any;
  const original = initial.character;
  const patched = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin",
    changes: { append_notes: ["A new fact."], relationships: [{ character_id: "mara", description: "New understanding." }] } }, context);
  const state = patched.new_state.data as any;
  assert.equal(state.character.currentGoal, original.currentGoal);
  assert.equal(state.character.lore, original.lore);
  for (const relationship of original.relationships.filter((r: any) => r.characterId !== "mara")) {
    assert.deepEqual(state.character.relationships.find((r: any) => r.characterId === relationship.characterId), relationship);
  }
  const cleared = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin",
    changes: { active_objective: { action: "drop", reason: "The greeting is no longer relevant." } } }, context);
  assert.equal((cleared.new_state.data as any).character.currentGoal, "");
  assert.equal((cleared.new_state.data as any).activity.status, "idle");
  assert.ok((cleared.new_state.data as any).notes.some((note: any) => note.text === "A new fact."));
});

const call = (name: string, args: unknown) => ({ role: "assistant" as const, content: null, tool_calls: [
  { id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } },
] });
const synchronousCommit = async <T>(work: () => T) => work();
async function dialogue(runtime: BrowserGameRuntime, t: any) {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: JSON.stringify({ utterance: "Goodbye.", replyOptions: [], endConversation: true }) }));
  await runtime.talkToCharacter("corvin", "Goodbye.");
}

test("agent-visible write descriptions document plain atomic patch semantics", () => {
  const tools = resourceReviewTools();
  const character = tools.find(t => t.function.name === "update_character")!;
  assert.match(character.function.description, /Omitted fields stay unchanged/);
  assert.match(character.function.description, /dialogue_objectives/);
  assert.match(character.function.description, /no standalone goal field exists/);
  assert.match(tools.find(t => t.function.name === "patch_world_state")!.function.description, /Atomically apply an RFC 6902 JSON Patch/);
});

test("active objective guidance includes a concrete plan and definition-of-done example", () => {
  const instructions = resourceReviewTools().find(tool => tool.function.name === "update_character")!.function.description
    + JSON.stringify(resourceReviewTools().find(tool => tool.function.name === "update_character")!.function.parameters);
  assert.match(instructions, /status must describe current knowledge, progress and the remaining execution plan/);
  assert.match(instructions, /requires waiting for another character to initiate a conversation/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /Waiting for another character to act is not an executable current goal/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /set the objective active again/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /Find out who stole my ring/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /credible evidence identifying who removed the ring/);
  assert.match(ACTIVE_OBJECTIVE_GUIDANCE, /Talk to Malcom/);
});
