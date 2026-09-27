import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { resourceReviewTools, type ResourceReviewContext } from "../apps/web/src/resource-review.js";

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
