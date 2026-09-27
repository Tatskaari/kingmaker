import assert from "node:assert/strict";
import test from "node:test";
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
