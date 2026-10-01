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
const id = (runtime: BrowserGameRuntime, key: string) => runtime.readResources([key])[key]!.generationId;

const objective = { action: "set", name: "Gather the court", status: "Garran agreed. Invite Lucan, then verify arrivals.",
  success_criteria: "All delegates are in the Treasury ready to listen.", current_goal: "Talk to Lucan", reason: "Accepted the request" };
const characterState = (runtime: BrowserGameRuntime) => (runtime.readResources(["character:corvin"])["character:corvin"]!.state as any);
function objectiveWrite(runtime: BrowserGameRuntime, change: unknown, generation = id(runtime, "character:corvin")) {
  return runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: generation,
    changes: { active_objective: change } }, context);
}

test("objective plan and goal commit together, survive saves, and reject stale updates", () => {
  const runtime = game(), previous = id(runtime, "character:corvin");
  objectiveWrite(runtime, objective);
  assert.equal(characterState(runtime).character.activeObjective.currentGoal, "Talk to Lucan");
  const saved = runtime.snapshot();
  const restored = game(); restored.restore(saved);
  assert.equal(characterState(restored).character.activeObjective.status, objective.status);
  assert.equal((objectiveWrite(runtime, { action: "drop", reason: "Stale decision" }, previous) as any).commit_result, "error");
  assert.ok(runtime.hasActiveObjective("corvin"));
  const generation = id(runtime, "character:corvin");
  assert.throws(() => objectiveWrite(runtime, { ...objective, status: "" }), /status/);
  assert.equal(id(runtime, "character:corvin"), generation);
  assert.throws(() => runtime.applyResourceReviewWrite("update_character", {
    character_id: "corvin", generation_id: generation, changes: { current_goal: null },
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
    character_id: "corvin", generation_id: id(runtime, "character:corvin"),
    changes: { dialogue_objectives: [revised, "Warn the player that Corvin will require authenticated evidence."] },
  }, context) as any;
  assert.equal(first.commit_result, "success");
  assert.deepEqual(characterState(runtime).character.dialogueObjectives, [revised, "Warn the player that Corvin will require authenticated evidence."]);
  assert.equal(characterState(runtime).character.currentGoal, originalGoal);

  const cleared = runtime.applyResourceReviewWrite("update_character", {
    character_id: "corvin", generation_id: first.new_state.generation_id,
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
      return call("update_character", { character_id: "corvin", generation_id: world(input)["character:corvin"].generation_id,
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

test("resource tools have explicit single generation IDs, not a batch commit", () => {
  const tools = resourceReviewTools();
  assert.ok(!tools.some(t => t.function.name === "commit_review"));
  for (const tool of tools.filter(t => !["read_state", "finish_review"].includes(t.function.name))) {
    assert.ok((tool.function.parameters.required as string[]).includes("generation_id"));
    assert.ok(!("generations" in (tool.function.parameters.properties as object)));
  }
});

test("character writes return fresh state on conflict without touching other resources", () => {
  const runtime = game(), initial = id(runtime, "character:corvin");
  const mara = id(runtime, "character:mara"), inventory = id(runtime, "inventory:corvin");
  const first = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: initial,
    changes: { ...changes, lore: "A revised biography." } }, context);
  assert.equal(first.commit_result, "success");
  assert.notEqual(first.new_state.generation_id, initial);
  const before = runtime.snapshot();
  const stale = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: initial,
    changes: { ...changes, lore: "An obsolete biography." } }, context);
  assert.equal(stale.reason, "Generation ID out of date");
  assert.equal(stale.new_state.generation_id, first.new_state.generation_id);
  assert.deepEqual(runtime.snapshot(), before);
  assert.equal(id(runtime, "character:mara"), mara);
  assert.equal(id(runtime, "inventory:corvin"), inventory);
});

test("inventory additions require only their inventory ID and validate atomically", () => {
  const runtime = game(), generation_id = id(runtime, "inventory:corvin");
  const item = { id: "review_note", name: "Note", details: "A written agreement.", reason: "A justified prop." };
  const before = runtime.snapshot();
  assert.throws(() => runtime.applyResourceReviewWrite("update_inventory", { owner_id: "corvin", generation_id, add_items: [item, item] }, context), /already exists/);
  assert.deepEqual(runtime.snapshot(), before);
  const result = runtime.applyResourceReviewWrite("update_inventory", { owner_id: "corvin", generation_id, add_items: [item] }, context);
  assert.equal(result.commit_result, "success");
  assert.equal(runtime.applyResourceReviewWrite("update_inventory", { owner_id: "corvin", generation_id, add_items: [{ ...item, id: "another_note" }] }, context).reason, "Generation ID out of date");
  assert.equal((result.new_state.data as { items: unknown[] }).items.length, 1);
});

test("give_item transfers an existing participant-owned item to the player exactly once", () => {
  const runtime = game();
  const item = { id: "corvin_signet", name: "Corvin's signet", details: "A silver signet.", reason: "Established possession." };
  runtime.applyResourceReviewWrite("update_inventory", {
    owner_id: "corvin", generation_id: id(runtime, "inventory:corvin"), add_items: [item],
  }, context);
  const generation_id = id(runtime, "item:corvin_signet");
  const result = runtime.applyResourceReviewWrite("give_item", {
    character_id: "corvin", item_id: "corvin_signet", generation_id,
    reason: "Corvin handed his signet to the player.",
  }, context);
  assert.equal(result.commit_result, "success");
  assert.equal((runtime.readResources(["item:corvin_signet"])["item:corvin_signet"]!.state as any).locationId, "player");
  assert.equal((runtime.readResources(["inventory:corvin"])["inventory:corvin"]!.state as any).items.some((item: any) => item.id === "corvin_signet"), false);
  assert.equal((runtime.readResources(["inventory:player"])["inventory:player"]!.state as any).items[0].id, "corvin_signet");
  assert.equal(runtime.applyResourceReviewWrite("give_item", {
    character_id: "corvin", item_id: "corvin_signet", generation_id, reason: "Repeat the handoff.",
  }, context).reason, "Generation ID out of date");
  assert.throws(() => runtime.applyResourceReviewWrite("give_item", {
    character_id: "mara", item_id: "corvin_signet", generation_id: id(runtime, "item:corvin_signet"), reason: "Mara hands it over.",
  }, context), /participating NPC/);
});

test("write_item creates an inspectable document directly in the player's inventory", () => {
  const runtime = game(), generation_id = id(runtime, "inventory:player");
  const item = { id: "corvin_agreement", name: "Formal agreement",
    details: "Corvin agrees to provide twenty guards at dawn.", reason: "Corvin wrote and handed over the agreed terms." };
  const result = runtime.applyResourceReviewWrite("write_item", {
    character_id: "corvin", generation_id, item,
  }, context);
  assert.equal(result.commit_result, "success");
  const written = (result.new_state.data as any).items.find((candidate: any) => candidate.id === item.id);
  assert.ok(!("locationId" in written));
  assert.equal(written.details, item.details);
  assert.equal(runtime.applyResourceReviewWrite("write_item", {
    character_id: "corvin", generation_id, item: { ...item, id: "stale_agreement" },
  }, context).reason, "Generation ID out of date");
  assert.throws(() => runtime.applyResourceReviewWrite("write_item", {
    character_id: "corvin", generation_id: id(runtime, "inventory:player"), item,
  }, context), /already exists/);
  assert.throws(() => runtime.applyResourceReviewWrite("write_item", {
    character_id: "mara", generation_id: id(runtime, "inventory:player"), item: { ...item, id: "mara_agreement" },
  }, context), /participating NPC/);
});

test("character reviews can revise passive objectives without activating them", () => {
  const runtime = game();
  const result = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: id(runtime, "character:corvin"), changes: {
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
  const patched = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: id(runtime, "character:corvin"),
    changes: { append_notes: ["A new fact."], relationships: [{ character_id: "mara", description: "New understanding." }] } }, context);
  const state = patched.new_state.data as any;
  assert.equal(state.character.currentGoal, original.currentGoal);
  assert.equal(state.character.lore, original.lore);
  for (const relationship of original.relationships.filter((r: any) => r.characterId !== "mara")) {
    assert.deepEqual(state.character.relationships.find((r: any) => r.characterId === relationship.characterId), relationship);
  }
  const cleared = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: patched.new_state.generation_id,
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
function world(input: any): any {
  return input.messages.map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } }).find((v: any) => v.world_state).world_state;
}

test("live review gets versions initially and explicitly reconciles a stale character write", async t => {
  const runtime = game(); await dialogue(runtime, t);
  const original = runtime.readResources(["character:corvin"])["character:corvin"]!.state as any;
  const fork = runtime.forkForResourceReview(synchronousCommit);
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
    calls++;
    assert.equal(input.response_format, undefined);
    assert.ok(!input.tools.some((tool: any) => tool.function.name === "commit_review"));
    assert.ok(input.tools.some((tool: any) => tool.function.name === "update_character"));
    const initial = world(input)["character:corvin"];
    if (calls === 1) {
      assert.ok(initial.generation_id);
      assert.ok(world(input)["inventory:corvin"].generation_id);
      runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: initial.generation_id, changes: { lore: "Concurrent biography." } }, context);
      return call("update_character", { character_id: "corvin", generation_id: initial.generation_id, changes: { append_notes: ["Reviewed goodbye."] } });
    }
    const result = JSON.parse(input.messages.at(-1).content);
    if (calls === 2) {
      assert.equal(result.commit_result, "error");
      assert.equal(result.reason, "Generation ID out of date");
      assert.equal(result.new_state.data.character.lore, "Concurrent biography.");
      assert.ok(!result.new_state.data.notes.some((note: any) => note.text === "Reviewed goodbye."));
      const active = result.new_state.data.character.activeObjective;
      return call("update_character", { character_id: "corvin", generation_id: result.new_state.generation_id, changes: {
        append_notes: ["Reviewed goodbye."], active_objective: {
          action: "set", reason: "The greeting remains unfinished after saying goodbye.", name: active.name,
          status: active.status, success_criteria: active.successCriteria, current_goal: active.currentGoal,
        },
      } });
    }
    assert.equal(result.commit_result, "success");
    return call("finish_review", { summary: "Goodbye remembered." });
  });
  await fork.endConversation("corvin");
  assert.equal(calls, 3);
  const state = runtime.readResources(["character:corvin"])["character:corvin"]!.state as any;
  assert.equal(state.character.lore, "Concurrent biography.");
  assert.equal(state.character.currentGoal, original.character.currentGoal);
  assert.equal(state.notes.filter((note: any) => note.text === "Reviewed goodbye.").length, 1);
  assert.equal(runtime.snapshot().conversations.corvin, undefined);
});

test("successful resource writes survive a later failed review and retry reads saved state", async t => {
  const runtime = game(); await dialogue(runtime, t);
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
    if (++calls > 1) throw new Error("Network unavailable");
    return call("update_inventory", { owner_id: "corvin", generation_id: world(input)["inventory:corvin"].generation_id,
      add_items: [{ id: "saved_note", name: "Note", details: "Already saved.", reason: "Agreed in conversation." }] });
  });
  await assert.rejects(runtime.forkForResourceReview(synchronousCommit).endConversation("corvin"), /Network unavailable/);
  assert.ok(runtime.snapshot().conversations.corvin?.length);
  assert.equal((runtime.readResources(["inventory:corvin"])["inventory:corvin"]!.state as any).items.length, 1);
  let retryCalls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
    assert.equal(world(input)["inventory:corvin"].data.items[0].id, "saved_note");
    if (retryCalls++ === 0) return call("update_character", { character_id: "corvin",
      generation_id: world(input)["character:corvin"].generation_id,
      changes: { active_objective: { action: "complete", reason: "The greeting conversation has ended." } } });
    return call("finish_review", { summary: "No further changes." });
  });
  await runtime.forkForResourceReview(synchronousCommit).endConversation("corvin");
  assert.equal(runtime.snapshot().conversations.corvin, undefined);
  assert.equal((runtime.readResources(["inventory:corvin"])["inventory:corvin"]!.state as any).items.length, 1);
});

test("agent-visible write descriptions document ID source, patch semantics, and error recovery", () => {
  const tools = resourceReviewTools();
  for (const tool of tools.filter(t => (t.function.parameters.required as string[]).includes("generation_id"))) {
    assert.match(tool.function.description, /generation_id/);
    assert.match(tool.function.description, /Generation ID out of date/);
    assert.match(tool.function.description, /Earlier successful calls remain saved/);
  }
  const character = tools.find(t => t.function.name === "update_character")!;
  assert.match(character.function.description, /Omitted fields stay unchanged/);
  assert.match(character.function.description, /dialogue_objectives/);
  assert.match(character.function.description, /no standalone goal field exists/);
  assert.match(character.function.description, /Example:/);
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
