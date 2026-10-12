import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld } from "./fixtures.js";
import { createScenarioServices } from "../packages/lore/src/services.js";

test("generic hook effects remove empty fixtures and broadcast private memories once", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  await services.docs.create("Hooks/milestone.ts", `export default async function run(services: HookServices): Promise<TransitionResult> {
    await services.map.removeFixtures(["furn_cart_left"]);
    await services.memories.broadcast("test-milestone", { title: "Milestone", context: "Public milestone", content: "Everyone learns this.", review: "Update affected dialogue." });
    return { status: "accepted" };
  }`);
  const before = services.currentWorld().simulation!.map!;
  const run = services.hooks.bind()["milestone.ts"]!;
  await run(new AbortController().signal);
  const count = Object.keys(services.currentWorld().docs).length;
  await run(new AbortController().signal);
  assert.equal(Object.keys(services.currentWorld().docs).length, count);
  assert.ok(before.fixtures.some(f => f.id === "furn_cart_left"));
  assert.ok(!services.currentWorld().simulation!.map!.fixtures.some(f => f.id === "furn_cart_left"));
  for (const actor of Object.values(services.currentWorld().simulation!.runtimeCharacters)) {
    const path = actor.document.slice(0, actor.document.lastIndexOf("/") + 1) + "memories/test-milestone.md";
    assert.equal(services.currentWorld().docs[path]!.body, "Everyone learns this.");
    assert.equal(services.currentWorld().docs[path]!.frontmatter!.visibility, "private");
  }
  assert.equal(services.currentWorld().docs["Reviews/test-milestone.md"]!.frontmatter!.visibility, "gm");
});

test("quest Run bindings execute saved hooks and reject without advancing", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  await services.docs.create("Hooks/reject-milestone.ts", `export default async function run(services: HookServices): Promise<TransitionResult> {
    return { status: "rejected", message: services.transition?.evidence || "No evidence" };
  }`);
  const path = "Scenarios/Centennial Assembly/Quests/Assembly Programme/quest.md";
  const doc = await services.docs.read(path);
  await services.docs.replace(path, doc.sha, "Holt has told the player that the pillow delivery is probably blocked by Rowan’s cart.\n#### Trigger: none", "Holt has told the player that the pillow delivery is probably blocked by Rowan’s cart.\n#### Trigger: none\n#### Run: reject-milestone.ts");
  const before = services.quests.read("assembly_programme");
  const result = await services.hooks.transition("assembly_programme", "learn_cart_blocked", before.revision, "Not yet", new AbortController().signal);
  assert.deepEqual(result, { status: "rejected", message: "Not yet" });
  assert.deepEqual(services.quests.read("assembly_programme"), before);
});

test("populated fixtures cannot be removed through hooks", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  await services.docs.create("Hooks/remove-supplies.ts", `export default async function run(services: HookServices): Promise<TransitionResult> {
    await services.map.removeFixtures(["furn_delivery_cushions"]);
    return { status: "accepted" };
  }`);
  const map = services.currentWorld().simulation!.map;
  await assert.rejects(services.hooks.bind()["remove-supplies.ts"]!(new AbortController().signal));
  assert.equal(services.currentWorld().simulation!.map, map);
});

test("authored fixture predicates run their hook only when the condition becomes true", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  await services.docs.create("Hooks/predicate-effect.ts", `export default async function run(services: HookServices): Promise<TransitionResult> {
    await services.memories.broadcast("predicate-test", { title: "Done", context: "Fixture removed", content: "A fixture is gone.", review: "Update dialogue." });
    return { status: "accepted" };
  }`);
  await services.docs.create("Scenarios/Centennial Assembly/Quests/Predicate test/quest.md", `---
id: predicate_test
title: Predicate test
initial: blocked
active: true
visibility: gm
summary: Fixture predicate test.
---
## Node: blocked
### Guidance
Wait for the fixture removal.
### Quest Log
Wait for the obstruction to be removed.
### When: cleared -> clear
The blocking fixture has been removed.
#### Trigger: fixture_absent furn_cart_left
#### Run: predicate-effect.ts
## Node: clear
### Guidance
The fixture is gone.
### Quest Log
The obstruction is gone.
`);
  const signal = new AbortController().signal;
  await services.quests.setActive("predicate_test", true, services.quests.read("predicate_test").revision);
  await services.hooks.evaluatePredicates(signal);
  assert.equal(services.quests.read("predicate_test").currentStageId, "blocked");
  await services.docs.create("Hooks/remove-empty.ts", `export default async function run(services: HookServices): Promise<TransitionResult> {
    await services.map.removeFixtures(["furn_cart_left"]); return { status: "accepted" };
  }`);
  await services.hooks.bind()["remove-empty.ts"]!(signal);
  await services.hooks.evaluatePredicates(signal);
  assert.equal(services.quests.read("predicate_test").currentStageId, "clear");
  assert.ok(services.currentWorld().docs["Reviews/predicate-test.md"]);
  await services.hooks.evaluatePredicates(signal);
  assert.equal(services.quests.read("predicate_test").history.length, 1);
});
