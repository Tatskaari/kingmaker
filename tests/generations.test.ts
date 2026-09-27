import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { create, fromJson, fromJsonString, toJson } from "@bufbuild/protobuf";
import { ObjectStateSchema, ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
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

function runtime() {
  const game = new BrowserGameRuntime(fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "test");
  game.createDevelopmentPlayer();
  return game;
}

test("runtime inventories merge independently and reject stale writes atomically", () => {
  const game = runtime();
  const prepare = (id: string, itemId: string) => {
    const expected = generationIds(game.readResources(["world:context", `character:${id}`, `actor:${id}`, `inventory:${id}`, `item:${itemId}`, `entity:${itemId}`]));
    const before = game.snapshot(), fork = game.forkForNpc(), snapshot = fork.snapshot();
    const scenario = fromJson(ScenarioSchema, snapshot.scenario);
    scenario.world!.objects.push(create(ObjectStateSchema, { id: itemId, name: itemId, locationId: id }));
    snapshot.scenario = toJson(ScenarioSchema, scenario); fork.restore(snapshot);
    return { before, fork, expected };
  };
  const first = prepare("corvin", "first_note"), second = prepare("mara", "second_note");
  game.commitCharacterFork(first.before, first.fork, ["corvin"], first.expected);
  game.commitCharacterFork(second.before, second.fork, ["mara"], second.expected);
  const saved = game.snapshot();
  assert.ok(fromJson(ScenarioSchema, saved.scenario).world!.objects.some(item => item.id === "first_note"));
  assert.ok(fromJson(ScenarioSchema, saved.scenario).world!.objects.some(item => item.id === "second_note"));
  assert.throws(() => game.commitCharacterFork(first.before, first.fork, ["corvin"], first.expected), GenerationConflict);
  assert.deepEqual(game.snapshot(), saved);
});

test("physical movement and reset advance the appropriate generations", () => {
  const game = runtime(), initial = game.readResources();
  const start = (initial["actor:player"]!.state as any).position;
  game.movePlayer({ x: 15, y: 24 });
  game.movePlayer(start);
  const moved = game.readResources();
  assert.notEqual(moved["actor:player"]!.generationId, initial["actor:player"]!.generationId);
  assert.equal(moved["character:player"]!.generationId, initial["character:player"]!.generationId);
  const saved = game.snapshot(); game.restore(saved);
  assert.deepEqual(game.readResources(), moved);
  game.resetCharacters();
  assert.notEqual(game.readResources()["character:corvin"]!.generationId, initial["character:corvin"]!.generationId);
});
