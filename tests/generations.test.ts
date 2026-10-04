import { inventoryOwners, locatedItems, inventoryFor, transferItem } from "../packages/core/src/inventory.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { create, fromJson, fromJsonString, toJson } from "@bufbuild/protobuf";
import { ItemInstanceSchema, ScenarioSchema } from "../packages/contracts/src/index.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { courtAgentObservation } from "../apps/web/src/court-agent.js";
import { GenerationConflict, GenerationStore, generationIds } from "../packages/core/src/generations.js";

test("generations isolate resources, survive saves, and detect ABA and deletion", () => {
  const store = new GenerationStore();
  const resources = { "character:a": { goal: "Wait" }, "inventory:a": [] as string[], "inventory:b": [] as string[] };
  const initial = generationIds(store.read(resources));
  resources["inventory:b"].push("key"); store.observe(resources);
  store.check(resources, { "character:a": initial["character:a"]!, "inventory:a": initial["inventory:a"]! }, ["character:a"]);
  resources["character:a"].goal = "Walk"; store.observe(resources);
  resources["character:a"].goal = "Wait"; store.observe(resources);
  assert.throws(() => store.check(resources, { "character:a": initial["character:a"]! }, ["character:a"]), GenerationConflict);
  const saved = store.snapshot(), restored = new GenerationStore(saved);
  assert.deepEqual(restored.read(resources), store.read(resources));
  const absent = generationIds(store.read(resources, ["item:key"]));
  store.observe({ ...resources, "item:key": { owner: "a" } });
  store.observe(resources);
  assert.throws(() => store.check(resources, absent, ["item:key"]), GenerationConflict);
});

test("conflicts return fresh state and require an explicit reconciled write", () => {
  const store = new GenerationStore(), resources = { "character:a": { goal: "Wait" } };
  const before = generationIds(store.read(resources));
  resources["character:a"].goal = "Walk"; store.observe(resources);
  let conflict!: GenerationConflict;
  try { store.check(resources, before, ["character:a"]); }
  catch (error) { assert.ok(error instanceof GenerationConflict); conflict = error; }
  assert.deepEqual(conflict.response.current["character:a"]!.state, { goal: "Walk" });
  assert.match(conflict.response.instruction, /call the write tool again/);
  store.check(resources, generationIds(conflict.response.current), ["character:a"]);
  assert.throws(() => store.check(resources, {}, ["character:a"]), GenerationConflict);
});

test("missing generation errors name every requirement without claiming state changed", () => {
  const store = new GenerationStore();
  const resources = { "character:rowan": { goal: "Talk" }, "door:hall": { open: true }, "actor:listener": { x: 1 } };
  const ids = generationIds(store.read(resources));
  const required = [...Object.keys(resources), "door:hall"];
  let response!: GenerationConflict["response"];
  assert.throws(() => store.check(resources, { "character:rowan": ids["character:rowan"]! }, required), error => {
    assert.ok(error instanceof GenerationConflict);
    response = error.response;
    assert.equal(response.error, "missing_generation_ids");
    assert.deepEqual(response.requiredResourceIds, Object.keys(resources));
    assert.deepEqual(response.missingResourceIds, ["door:hall", "actor:listener"]);
    assert.deepEqual(response.staleResourceIds, []);
    assert.match(response.instruction, /Missing IDs do not mean those resources changed/);
    assert.match(error.message, /door:hall/);
    return true;
  });
  assert.deepEqual(generationIds(store.read(resources)), ids);
  store.check(resources, generationIds(response.current), required);
});

test("mixed failures distinguish absent IDs from stale dependencies", () => {
  const store = new GenerationStore();
  const resources = { "character:rowan": { goal: "Talk" }, "door:hall": { open: true }, "actor:listener": { x: 1 } };
  const ids = generationIds(store.read(resources));
  resources["actor:listener"].x = 2;
  // Caller-supplied dependencies must remain guarded even beyond required IDs.
  assert.throws(() => store.check(resources, { "actor:listener": ids["actor:listener"]!, "door:hall": "" }, ["character:rowan", "door:hall"]), error => {
    assert.ok(error instanceof GenerationConflict);
    assert.equal(error.response.error, "generation_conflict");
    assert.deepEqual(error.response.missingResourceIds, ["character:rowan", "door:hall"]);
    assert.deepEqual(error.response.staleResourceIds, ["actor:listener"]);
    assert.deepEqual(error.response.current["actor:listener"]!.state, { x: 2 });
    assert.match(error.response.instruction, /reconcile/);
    return true;
  });
});

const memory = { newNotes: [], relationships: [], lore: null, goalUpdate: null };
const reply = (value: unknown) => ({ role: "assistant" as const, content: JSON.stringify(value) });
const write = (generations: Record<string, string>, review = memory, worldChanges: unknown[] = []) => ({
  role: "assistant" as const, content: null, tool_calls: [{ id: "write", type: "function" as const,
    function: { name: "commit_review", arguments: JSON.stringify({ generations, review, worldChanges }) } }],
});

const debugObjective = { name: "Find the ring", status: "Ask Lucan what he saw.",
  success_criteria: "The ring is recovered.", current_goal: "Speak to Lucan" };
