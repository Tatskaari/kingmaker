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
