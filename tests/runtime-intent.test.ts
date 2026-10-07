import assert from "node:assert/strict";
import test from "node:test";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { formatActivity } from "../packages/lore/src/activity.js";
import { runtimeActor, seedRuntimeCharacter } from "../packages/lore/src/runtime-actor.js";
import { loadPlayableWorld } from "./fixtures.js";
function fixture() {
  const world = loadPlayableWorld();
  for (const actor of world.simulation!.map!.actors.filter(actor => actor.characterId !== "player")) {
    const identity = world.simulation!.runtimeCharacters[actor.characterId]?.characterId ?? actor.characterId;
    seedRuntimeCharacter(world, actor.instanceId ?? actor.characterId, identity,
      `Scenarios/Centennial Assembly/Characters/${identity}/character.md`);
  }
  return world;
}

const task = "Scenarios/Centennial Assembly/Characters/palace-guard/task.md";
const text = formatActivity("palace-guard", { name: "Watch the door", status: "Assigned",
  success_criteria: "Keep the door clear", current_goal: "Watch the door" });

test("shared guard lore retains independent, saved body intent and rejects stale atomic writes", async () => {
  const services = createScenarioServices(fixture());
  const entry = "Scenarios/Centennial Assembly/Characters/palace-guard/character.md";
  const before = await services.docs.read(entry);
  await services.docs.commit([{ path: task, expectedSha: null, text }], [
    { actorId: "palace-guard-1", expectedRevision: 0, activity: task, wait: null },
  ]);
  assert.equal((await services.docs.read(entry)).sha, before.sha);
  const saved = fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.read()));
  assert.equal(runtimeActor(saved, "palace-guard-1").activity, task);
  assert.equal(runtimeActor(saved, "palace-guard-2").activity, undefined);
  const failedTask = task.replace("task.md", "failed.md");
  await assert.rejects(services.docs.commit([{ path: failedTask, expectedSha: null, text }], [
    { actorId: "palace-guard-1", expectedRevision: 0, activity: failedTask, wait: null },
  ]), /document changed/);
  assert.equal(services.scenario.read().docs[failedTask], undefined);
  assert.equal(runtimeActor(services.scenario.read(), "palace-guard-1").activity, task);
});

test("scene defaults seed independent actor fields and intent permissions still apply", async () => {
  const world = fixture(), actor = runtimeActor(world, "palace-guard-1");
  world.docs[actor.document]!.frontmatter!.activity = task;
  seedRuntimeCharacter(world, actor.id, actor.characterId, actor.document);
  assert.equal(runtimeActor(world, actor.id).activity, task);
  assert.equal(runtimeActor(world, "palace-guard-2").activity, undefined);
  delete world.docs[actor.document]!.frontmatter!.activity;
  seedRuntimeCharacter(world, actor.id, actor.characterId, actor.document);
  const services = createScenarioServices(world);
  await services.docs.create(task, text);
  await assert.rejects(services.docs.commit([], [
    { actorId: "corvin", expectedRevision: 0, activity: task, wait: null },
  ]), /No read access/);
});

test("active runtime paths prevent deleting their target documents", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  await services.docs.commit([{ path: task, expectedSha: null, text }], [
    { actorId: "palace-guard-1", expectedRevision: 0, activity: task, wait: null },
  ]);
  const before = await services.docs.read(task);
  await assert.rejects(services.docs.delete(task, before.sha), /Missing intent document/);
  assert.equal((await services.docs.read(task)).sha, before.sha);
});

test("fresh scene defaults seed runtime characters once, including unplaced CLI characters", async () => {
  const { create } = await import("@bufbuild/protobuf");
  const { MapStateSchema: MapSchema } = await import("../packages/contracts/src/index.js");
  const { worldState } = await import("../packages/lore/src/world-state.js");
  const entry = "Scenarios/Test/Characters/palace-guard/character.md";
  const world = worldState(create(MapSchema), new Map([
    ["Scenarios/Test/scenario.md", `[[${entry}]]`], ["Scenarios/Test/index.md", "Index"],
    [entry, `---\nactivity: ${task}\n---\nGuard`], [task, text],
  ]), "Test");
  assert.equal(world.simulation!.runtimeCharacters["palace-guard"]!.activity, task);
  const services = createScenarioServices(world);
  await services.docs.commit([], [{ actorId: "palace-guard", expectedRevision: 0, activity: null, wait: null }]);
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.read())));
  assert.equal(restored.scenario.read().simulation!.runtimeCharacters["palace-guard"]!.activity, undefined);
  assert.equal(restored.scenario.read().docs[entry]!.frontmatter!.activity, task);
  assert.deepEqual(restored.scenario.read().simulation!.map, world.simulation!.map);
});
