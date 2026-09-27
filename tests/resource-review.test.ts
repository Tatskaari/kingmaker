import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { resourceReviewTools, type ResourceReviewContext } from "../apps/web/src/resource-review.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";

const context: ResourceReviewContext = { kind: "conversation_review", participants: ["corvin"],
  eligibleListeners: ["mara"], playerCanHear: true, allowNextGoal: true };
const changes = { append_events: [], relationships: [] };
function game() {
  const runtime = new BrowserGameRuntime(fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "test");
  runtime.createDevelopmentPlayer(); return runtime;
}
const id = (runtime: BrowserGameRuntime, key: string) => runtime.readResources([key])[key]!.generationId;

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
  assert.equal((result.new_state.data as unknown[]).length, 1);
});

test("overhearing writes only the listener, without door dependencies", () => {
  const runtime = game(), doors = id(runtime, "door:hall_door");
  const result = runtime.applyResourceReviewWrite("record_overheard", { characterId: "mara", generation_id: id(runtime, "character:mara"),
    summary: "Heard a mention of the treasury.", reactionGoal: null }, context);
  assert.equal(result.commit_result, "success");
  assert.equal(id(runtime, "door:hall_door"), doors);
  assert.throws(() => runtime.applyResourceReviewWrite("record_overheard", { characterId: "oswin", generation_id: id(runtime, "character:oswin"),
    summary: "Impossible hearing.", reactionGoal: null }, context), /eligible/);
});

test("omitted fields preserve goals and relationships; null explicitly makes the NPC idle", () => {
  const runtime = game();
  const initial = runtime.readResources(["character:corvin"])["character:corvin"]!.state as any;
  const original = initial.character;
  const patched = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: id(runtime, "character:corvin"),
    changes: { append_events: [{ type: "memory", summary: "A new fact." }], relationships: [{ character_id: "mara", description: "New understanding." }] } }, context);
  const state = patched.new_state.data as any;
  assert.equal(state.character.currentGoal, original.currentGoal);
  assert.equal(state.character.lore, original.lore);
  for (const relationship of original.relationships.filter((r: any) => r.characterId !== "mara")) {
    assert.deepEqual(state.character.relationships.find((r: any) => r.characterId === relationship.characterId), relationship);
  }
  const cleared = runtime.applyResourceReviewWrite("update_character", { character_id: "corvin", generation_id: patched.new_state.generation_id,
    changes: { current_goal: null } }, context);
  assert.equal((cleared.new_state.data as any).character.currentGoal, "");
  assert.equal((cleared.new_state.data as any).activity.status, "idle");
  assert.ok((cleared.new_state.data as any).memories.some((e: any) => e.summary === "A new fact."));
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
      return call("update_character", { character_id: "corvin", generation_id: initial.generation_id, changes: { append_events: [{ type: "memory", summary: "Reviewed goodbye." }] } });
    }
    const result = JSON.parse(input.messages.at(-1).content);
    if (calls === 2) {
      assert.equal(result.commit_result, "error");
      assert.equal(result.reason, "Generation ID out of date");
      assert.equal(result.new_state.data.character.lore, "Concurrent biography.");
      assert.ok(!result.new_state.data.memories.some((e: any) => e.summary === "Reviewed goodbye."));
      return call("update_character", { character_id: "corvin", generation_id: result.new_state.generation_id, changes: { append_events: [{ type: "memory", summary: "Reviewed goodbye." }] } });
    }
    assert.equal(result.commit_result, "success");
    return call("finish_review", { summary: "Goodbye remembered." });
  });
  await fork.endConversation("corvin");
  assert.equal(calls, 3);
  const state = runtime.readResources(["character:corvin"])["character:corvin"]!.state as any;
  assert.equal(state.character.lore, "Concurrent biography.");
  assert.equal(state.character.currentGoal, original.character.currentGoal);
  assert.equal(state.memories.filter((e: any) => e.summary === "Reviewed goodbye.").length, 1);
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
  assert.equal((runtime.readResources(["inventory:corvin"])["inventory:corvin"]!.state as any[]).length, 1);
  t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
    assert.equal(world(input)["inventory:corvin"].data[0].id, "saved_note");
    return call("finish_review", { summary: "No further changes." });
  });
  await runtime.forkForResourceReview(synchronousCommit).endConversation("corvin");
  assert.equal(runtime.snapshot().conversations.corvin, undefined);
  assert.equal((runtime.readResources(["inventory:corvin"])["inventory:corvin"]!.state as any[]).length, 1);
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
  assert.match(character.function.description, /null explicitly clears/);
  assert.match(character.function.description, /Example:/);
});
