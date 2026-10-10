import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { MapStateSchema } from "../packages/contracts/src/index.js";
import { QuestSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices, QuestConflictError } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";

function fixture() {
  return createScenarioServices(worldState(create(MapStateSchema), new Map([
    ["Scenarios/Test/scenario.md", "Briefing"], ["Scenarios/Test/index.md", "Navigation"],
  ]), "Test"));
}
function definition() {
  return create(QuestSchema, {
    id: "delivery", initialStageId: "blocked",
    stages: ["blocked", "unloading", "delivered"].map(id => ({ id, description: id })),
    transitions: [
      ...["repair", "back_out"].map(id => ({ id, fromStageId: "blocked", toStageId: "unloading" })),
      { id: "finish", fromStageId: "unloading", toStageId: "delivered" },
      { id: "retry", fromStageId: "unloading", toStageId: "blocked" },
    ],
  });
}

test("registration and reads isolate quest data while preserving other world state", async () => {
  const { quests, currentWorld, docs } = fixture();
  const world = currentWorld(), input = definition();
  const registered = quests.register(input);
  input.stages[0]!.description = "external mutation";
  (await registered).quest!.stages[0]!.description = "returned mutation";
  quests.list()[0]!.currentStageId = "delivered";
  quests.read("delivery").quest!.transitions.length = 0;
  quests.availableTransitions("delivery")[0]!.toStageId = "delivered";
  assert.equal(quests.read("delivery").quest!.stages[0]!.description, "blocked");
  assert.equal(quests.read("delivery").currentStageId, "blocked");
  assert.deepEqual(quests.availableTransitions("delivery").map(edge => edge.id), ["repair", "back_out"]);
  assert.strictEqual(currentWorld().docs, world.docs);
  assert.strictEqual(currentWorld().simulation, world.simulation);
  await docs.create("note.md", "A new note");
  assert.equal(quests.list().length, 1);
});

test("concurrent and repeated transitions have one winner and survive save/resume", async () => {
  const { quests, currentWorld } = fixture();
  await quests.register(definition());
  const results = await Promise.allSettled([
    quests.transition("delivery", "back_out", 0, "Cart cleared"),
    quests.transition("delivery", "repair", 0),
  ]);
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  if (results[1]!.status === "rejected") assert.ok(results[1].reason instanceof QuestConflictError);
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, currentWorld()))).quests;
  await assert.rejects(restored.transition("delivery", "back_out", 0), QuestConflictError);
  assert.equal(restored.read("delivery").history[0]!.evidence, "Cart cleared");
  await restored.transition("delivery", "retry", 1);
  await assert.rejects(restored.transition("delivery", "back_out", 0), QuestConflictError);
  await restored.transition("delivery", "repair", 2);
  const final = await restored.transition("delivery", "finish", 3);
  assert.equal(final.currentStageId, "delivered");
  assert.deepEqual(final.history.map(record => record.revision), [1, 2, 3, 4]);
  assert.deepEqual(restored.availableTransitions("delivery"), []);
});

test("invalid definitions and unavailable edges leave state unchanged and queue usable", async () => {
  const { quests } = fixture();
  for (const mutate of [
    (q: ReturnType<typeof definition>) => { q.id = ""; },
    (q: ReturnType<typeof definition>) => { q.stages[0]!.id = ""; },
    (q: ReturnType<typeof definition>) => { q.stages.push(q.stages[0]!); },
    (q: ReturnType<typeof definition>) => { q.transitions.push(q.transitions[0]!); },
    (q: ReturnType<typeof definition>) => { q.transitions[0]!.id = ""; },
    (q: ReturnType<typeof definition>) => { q.initialStageId = "missing"; },
    (q: ReturnType<typeof definition>) => { q.transitions[0]!.fromStageId = "missing"; },
    (q: ReturnType<typeof definition>) => { q.transitions[0]!.toStageId = "missing"; },
  ]) {
    const quest = definition(); mutate(quest);
    await assert.rejects(quests.register(quest));
    assert.deepEqual(quests.list(), []);
  }
  const initial = await quests.register(definition());
  await assert.rejects(quests.register(definition()), /already registered/);
  assert.throws(() => quests.read("missing"), /not found/);
  await assert.rejects(quests.transition("missing", "finish", 0), /not found/);
  for (const id of ["missing", "finish"]) await assert.rejects(quests.transition("delivery", id, 0), /not available/);
  assert.deepEqual(quests.read("delivery"), initial);
  assert.equal((await quests.transition("delivery", "repair", 0)).currentStageId, "unloading");
});
