import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { create, fromJson, fromJsonString, toJson } from "@bufbuild/protobuf";
import { ObjectStateSchema, ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
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

const memory = { newEvents: [], relationships: [], lore: null, goalUpdate: null };
const reply = (value: unknown) => ({ role: "assistant" as const, content: JSON.stringify(value) });
const write = (generations: Record<string, string>, review = memory, worldChanges: unknown[] = []) => ({
  role: "assistant" as const, content: null, tool_calls: [{ id: "write", type: "function" as const,
    function: { name: "commit_review", arguments: JSON.stringify({ generations, review, worldChanges }) } }],
});

test("the GM receives a conflict and must explicitly re-call the write tool", async t => {
  const game = runtime();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply({ utterance: "Goodbye.", replyOptions: [], endConversation: true }));
  await game.talkToCharacter("corvin", "Goodbye.");
  const before = game.snapshot(), fork = game.forkForNpc();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply(memory));
  await fork.endConversation("corvin");
  const changed = game.snapshot(), scenario = fromJson(ScenarioSchema, changed.scenario);
  scenario.characters.find(c => c.id === "corvin")!.lore = "A new fact learned while the review ran.";
  changed.scenario = toJson(ScenarioSchema, scenario); game.restore(changed);
  const liveBefore = game.snapshot();
  let calls = 0, commits = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    calls++;
    assert.ok(request.tools.some((tool: any) => tool.function.name === "commit_review"));
    if (calls === 1) {
      const initial = JSON.parse(request.messages.at(-1).content).resources;
      return write(generationIds(initial));
    }
    const conflict = JSON.parse(request.messages.at(-1).content);
    assert.equal(conflict.error, "generation_conflict");
    assert.match(conflict.current["character:corvin"].state.character.lore, /new fact/);
    assert.match(conflict.instruction, /call the write tool again/);
    assert.equal(commits, 0);
    assert.deepEqual(game.snapshot(), liveBefore);
    return write(generationIds(conflict.current));
  });
  await game.publishReviewedFork(before, fork, async (base, candidate, ids, expected) => {
    game.commitCharacterFork(base, candidate, ids, expected); commits++;
  });
  assert.equal(calls, 2); assert.equal(commits, 1);
  assert.equal(game.snapshot().conversations.corvin, undefined);
  assert.match(fromJson(ScenarioSchema, game.snapshot().scenario).characters.find(c => c.id === "corvin")!.lore, /new fact/);
});

test("plain final JSON cannot bypass the generation-aware write tool", async t => {
  const game = runtime();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply({ utterance: "Goodbye.", replyOptions: [], endConversation: true }));
  await game.talkToCharacter("corvin", "Goodbye.");
  const before = game.snapshot(), fork = game.forkForNpc();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply(memory));
  await fork.endConversation("corvin");
  await assert.rejects(game.publishReviewedFork(before, fork, async () => { assert.fail("Must not commit plain JSON"); }), /reconciliation limit/);
  assert.deepEqual(game.snapshot(), before);
});
