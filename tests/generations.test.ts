import { inventoryOwners, locatedItems, inventoryFor, transferItem } from "../packages/core/src/inventory.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { create, fromJson, fromJsonString, toJson } from "@bufbuild/protobuf";
import { ItemInstanceSchema, ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { actionResourceIds, courtAgentObservation } from "../apps/web/src/court-agent.js";
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
    inventoryFor(inventoryOwners(scenario.characters, scenario.world), id).items.push(create(ItemInstanceSchema, { id: itemId, name: itemId }));
    snapshot.scenario = toJson(ScenarioSchema, scenario); fork.restore(snapshot);
    return { before, fork, expected };
  };
  const first = prepare("corvin", "first_note"), second = prepare("mara", "second_note");
  game.commitCharacterFork(first.before, first.fork, ["corvin"], first.expected);
  game.commitCharacterFork(second.before, second.fork, ["mara"], second.expected);
  const saved = game.snapshot();
  const savedState = fromJson(ScenarioSchema, saved.scenario);
  assert.ok(locatedItems(inventoryOwners(savedState.characters, savedState.world)).some(item => item.id === "first_note"));
  assert.ok(locatedItems(inventoryOwners(savedState.characters, savedState.world)).some(item => item.id === "second_note"));
  assert.throws(() => game.commitCharacterFork(first.before, first.fork, ["corvin"], first.expected), GenerationConflict);
  assert.deepEqual(game.snapshot(), saved);
});

test("physical movement and reset advance the appropriate generations", () => {
  const game = runtime(), initial = game.readResources();
  const start = (initial["actor:player"]!.state as any).position;
  game.movePlayer({ x: 61, y: 24 });
  game.movePlayer(start);
  const moved = game.readResources();
  assert.notEqual(moved["actor:player"]!.generationId, initial["actor:player"]!.generationId);
  assert.equal(moved["character:player"]!.generationId, initial["character:player"]!.generationId);
  const saved = game.snapshot(); game.restore(saved);
  assert.deepEqual(game.readResources(), moved);
  game.resetCharacters();
  assert.notEqual(game.readResources()["character:corvin"]!.generationId, initial["character:corvin"]!.generationId);
});

const memory = { newNotes: [], relationships: [], lore: null, goalUpdate: null };
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

test("stale physical actions reject inventory ABA before movement or item use", () => {
  const game = runtime(), setup = game.snapshot();
  setup.npcActivities = { corvin: { status: "active", goal: "Inspect my note.", history: [] } };
  const scenario = fromJson(ScenarioSchema, setup.scenario);
  scenario.characters.find(c => c.id === "corvin")!.currentGoal = "Inspect my note.";
  inventoryFor(inventoryOwners(scenario.characters, scenario.world), "corvin").items.push(create(ItemInstanceSchema, { id: "note", name: "Note" }));
  setup.scenario = toJson(ScenarioSchema, scenario); game.restore(setup);
  const action = courtAgentObservation(scenario, "corvin").actions.find(item => item.id === "inspect_item_note")!;
  const expected = generationIds(game.readResources(actionResourceIds(scenario, "corvin", action)));
  const intervening = game.snapshot(), moved = fromJson(ScenarioSchema, intervening.scenario);
  transferItem(inventoryOwners(moved.characters, moved.world), "note", "mara");
  intervening.scenario = toJson(ScenarioSchema, moved); game.restore(intervening);
  const returned = game.snapshot(); // Preserve the generation of the intervening move.
  returned.scenario = setup.scenario; game.restore(returned);
  const before = game.snapshot();
  assert.throws(() => game.stepNpcAction("corvin", action.id, "Inspect my note.", expected), GenerationConflict);
  assert.deepEqual(game.snapshot(), before);
  const fresh = generationIds(game.readResources(actionResourceIds(scenario, "corvin", action)));
  assert.equal(game.stepNpcAction("corvin", action.id, "Inspect my note.", fresh).done, true);
});

test("player physical commands reject stale views without disclosing concealed item IDs", () => {
  const game = runtime(), view = game.view();
  const original = game.snapshot(), scenario = fromJson(ScenarioSchema, original.scenario);
  const hidden = locatedItems(inventoryOwners(scenario.characters, scenario.world)).find(item => item.concealed && !scenario.world!.fixtures.find(f => f.id === item.locationId)?.open)!;
  assert.ok(hidden);
  assert.equal(Object.hasOwn(view.generations as object, `item:${hidden.id}`), false);
  game.movePlayer({ x: 61, y: 24 });
  const before = game.snapshot();
  assert.throws(() => game.movePlayer({ x: 61, y: 25 }, view.generations as Record<string, string>), GenerationConflict);
  assert.deepEqual(game.snapshot(), before);
});

test("direct court GM writes return conflicts; creation writes need no generation IDs", async t => {
  for (const creation of [true, false]) {
    const game = creation ? new BrowserGameRuntime(fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "test") : runtime();
    let calls = 0;
    t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
      calls++;
      const tool = request.tools.find((tool: any) => tool.function.name === "update_character");
      assert.equal(tool.function.parameters.required.includes("generations"), !creation);
      if (calls === 1 || (!creation && calls === 2)) {
        const args: any = { characterId: "corvin", lore: "Reconciled biography.", activeObjective: {
          action: "drop", reason: "The GM explicitly cancelled the greeting objective.",
        } };
        if (calls === 2) {
          const result = JSON.parse(request.messages.at(-1).content);
          assert.equal(result.error, "missing_generation_ids");
          assert.ok(result.missingResourceIds.includes("character:corvin"));
          assert.notEqual(result.current["character:corvin"].state.character.lore, args.lore);
          args.generations = generationIds(result.current);
        }
        return { role: "assistant", content: null, tool_calls: [{ id: "update", type: "function", function: { name: "update_character", arguments: JSON.stringify(args) } }] };
      }
      return { role: "assistant", content: "Done." };
    });
    await game.talkToGameMaster("Update Corvin.");
    assert.equal(calls, creation ? 2 : 3);
    const saved = game.snapshot();
    assert.equal(fromJson(ScenarioSchema, saved.scenario).characters.find(c => c.id === "corvin")!.lore, "Reconciled biography.");
    if (!creation) assert.equal(saved.npcActivities!.corvin!.status, "idle");
  }
});

test("a conflict at publication keeps item and character updates atomic and reaches the agent", async t => {
  const game = runtime();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply({ utterance: "Goodbye.", replyOptions: [], endConversation: true }));
  await game.talkToCharacter("corvin", "Goodbye.");
  const before = game.snapshot(), fork = game.forkForNpc();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply(memory));
  await fork.endConversation("corvin");
  let calls = 0, commits = 0, generations: Record<string, string> = {};
  const changes = [{ name: "create_item", arguments: { id: "new_note", name: "New note", locationId: "corvin", details: "A note.", reason: "An established prop." } }];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    const context = JSON.parse(request.messages.at(-1).content);
    calls++;
    if (calls === 1) {
      generations = generationIds(context.resources);
      return { role: "assistant", content: null, tool_calls: [{ id: "read", type: "function", function: { name: "read_state", arguments: JSON.stringify({ resourceIds: ["item:new_note", "entity:new_note"] }) } }] };
    }
    Object.assign(generations, generationIds(context.current));
    if (calls === 3) {
      assert.equal(context.error, "generation_conflict");
      const scenario = fromJson(ScenarioSchema, game.snapshot().scenario);
      assert.ok(!locatedItems(inventoryOwners(scenario.characters, scenario.world)).some(item => item.id === "new_note"));
      assert.notEqual(scenario.characters.find(c => c.id === "corvin")!.lore, "Updated atomically.");
      assert.ok(context.current["inventory:corvin"].state.items.some((item: any) => item.id === "other_note"));
    }
    return write(generations, { ...memory, lore: "Updated atomically." } as any, changes);
  });
  await game.publishReviewedFork(before, fork, async (base, candidate, ids, expected) => {
    if (commits++ === 0) {
      const changed = game.snapshot(), scenario = fromJson(ScenarioSchema, changed.scenario);
      inventoryFor(inventoryOwners(scenario.characters, scenario.world), "corvin").items.push(create(ItemInstanceSchema, { id: "other_note", name: "Other note" }));
      changed.scenario = toJson(ScenarioSchema, scenario); game.restore(changed);
    }
    game.commitCharacterFork(base, candidate, ids, expected);
  });
  assert.equal(calls, 3); assert.equal(commits, 2);
  const final = fromJson(ScenarioSchema, game.snapshot().scenario);
  assert.equal(locatedItems(inventoryOwners(final.characters, final.world)).filter(item => ["new_note", "other_note"].includes(item.id)).length, 2);
  assert.equal(final.characters.find(c => c.id === "corvin")!.lore, "Updated atomically.");
});

test("a two-participant write cannot overwrite either participant when one changed", () => {
  const game = runtime(), before = game.snapshot(), fork = game.forkForNpc();
  const proposed = fork.snapshot(), scenario = fromJson(ScenarioSchema, proposed.scenario);
  for (const id of ["corvin", "mara"]) scenario.characters.find(c => c.id === id)!.lore = "Proposed biography.";
  proposed.scenario = toJson(ScenarioSchema, scenario); fork.restore(proposed);
  const concurrent = game.snapshot(), newer = fromJson(ScenarioSchema, concurrent.scenario);
  newer.characters.find(c => c.id === "mara")!.lore = "Concurrent biography.";
  concurrent.scenario = toJson(ScenarioSchema, newer); game.restore(concurrent);
  const unchanged = game.snapshot();
  assert.throws(() => game.commitCharacterFork(before, fork, ["corvin", "mara"]), GenerationConflict);
  assert.deepEqual(game.snapshot(), unchanged);
});

const debugObjective = { name: "Find the ring", status: "Ask Lucan what he saw.",
  success_criteria: "The ring is recovered.", current_goal: "Speak to Lucan" };

test("debug objective override resets execution, persists, and invalidates old character work", () => {
  const game = runtime(), before = game.snapshot(), fork = game.forkForNpc();
  const previous = game.readResources();
  game.overrideActiveObjective("corvin", debugObjective);
  const snapshot = game.snapshot(), scenario = fromJson(ScenarioSchema, snapshot.scenario);
  const character = scenario.characters.find(item => item.id === "corvin")!;
  assert.equal(character.activeObjective?.name, debugObjective.name);
  assert.equal(character.activeObjective?.status, debugObjective.status);
  assert.equal(character.activeObjective?.successCriteria, debugObjective.success_criteria);
  assert.equal(character.activeObjective?.currentGoal, debugObjective.current_goal);
  assert.equal(character.currentGoal, debugObjective.current_goal);
  assert.deepEqual(snapshot.npcActivities?.corvin, { status: "active", goal: debugObjective.current_goal, history: [] });
  const updated = game.readResources();
  assert.notEqual(updated["character:corvin"]!.generationId, previous["character:corvin"]!.generationId);
  assert.equal(updated["character:mara"]!.generationId, previous["character:mara"]!.generationId);
  assert.throws(() => game.commitCharacterFork(before, fork, ["corvin"]), GenerationConflict);
  const restored = runtime(); restored.restore(snapshot);
  assert.deepEqual(restored.debugCharacter("corvin").character, game.debugCharacter("corvin").character);
  assert.deepEqual(restored.snapshot().npcActivities, snapshot.npcActivities);
});

test("debug objective override rejects invalid fields and non-NPCs without changing state", () => {
  const game = runtime(), before = game.snapshot();
  for (const [id, objective] of [["player", debugObjective], ["missing", debugObjective],
    ["corvin", { ...debugObjective, current_goal: "  " }], ["corvin", null]] as const) {
    assert.throws(() => game.overrideActiveObjective(id, objective));
    assert.deepEqual(game.snapshot(), before);
  }
});
