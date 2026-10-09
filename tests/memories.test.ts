import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { MapStateSchema } from "../packages/contracts/src/index.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { memoryIndexPath, saveMemory } from "../packages/lore/src/memories.js";
import { documentLore } from "../packages/conversation/src/document-lore.js";

const entry = (id: string) => `Scenarios/Test/Characters/${id}/character.md`;
function fixture() {
  return createScenarioServices(worldState(create(MapStateSchema), new Map([
    ["Scenarios/Test/index.md", "Index"],
    ["Scenarios/Test/scenario.md", `[Alice](${entry("alice").replace("Scenarios/Test/", "")})\n[Bob](Characters/bob/character.md)`],
    ...["alice", "bob"].flatMap(id => [
      [entry(id), `---\nvisibility: private\nreaders: [character:${id}]\n---\n[[Cast/Test/${id}/private.md]]`],
      [`Cast/Test/${id}/private.md`, `---\nvisibility: private\nreaders: [character:${id}]\n---\n${id}'s identity`],
    ] as [string, string][]),
    ["gm.md", "---\nvisibility: gm\n---\nSecret"],
  ]), "Test"));
}
const memory = { title: 'A promise: "help"', context: "During a meeting in the hall.", content: "The visitor promised to return tomorrow." };

test("memories are indexed, scoped, disclosed on demand, and survive save/load", async () => {
  const services = fixture();
  const lore = await documentLore(services.scenario, "alice");
  assert.equal(lore.initial.at(-1)!.path, memoryIndexPath(entry("alice")));
  const saved = await saveMemory(services, "alice", memory);
  const doc = (await services.docs.read(saved.path)).document;
  assert.equal(doc.frontmatter!.title, memory.title);
  assert.equal(doc.frontmatter!.context, memory.context);
  assert.equal(doc.body.trim(), memory.content);
  const fresh = await documentLore(services.scenario, "alice");
  assert.ok(!fresh.initial.some(note => note.markdown.includes(memory.content)));
  assert.match(fresh.initial.at(-1)!.markdown, /During a meeting/);
  const candidate = fresh.links(fresh.initial).find(link => link.path === saved.path)!;
  assert.equal(candidate.summary, `${memory.title}: ${memory.context}`);
  assert.match((await fresh.open(candidate, new AbortController().signal)).markdown, /promised to return/);
  const bob = await documentLore(services.scenario, "bob");
  await assert.rejects(bob.open(candidate, new AbortController().signal), /No read access/);
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.read())));
  assert.equal((await restored.docs.read(saved.path)).sha, (await services.docs.read(saved.path)).sha);
  const second = await saveMemory(restored, "alice", memory);
  assert.notEqual(second.path, saved.path);
  assert.equal((await restored.docs.read(saved.index)).document.links.length, 2);
});

test("invalid memories and forbidden links leave both memory and index unpublished", async () => {
  const services = fixture(), index = memoryIndexPath(entry("alice"));
  const before = await services.docs.read(index), count = Object.keys(services.scenario.read().docs).length;
  await assert.rejects(saveMemory(services, "alice", { ...memory, title: " " }), /requires title/);
  await assert.rejects(saveMemory(services, "alice", { ...memory, content: "[[gm.md]]" }), /validation/i);
  assert.equal((await services.docs.read(index)).sha, before.sha);
  assert.equal(Object.keys(services.scenario.read().docs).length, count);
});

test("simultaneous saves conflict atomically instead of losing an index entry", async () => {
  const services = fixture(), count = Object.keys(services.scenario.read().docs).length;
  const results = await Promise.allSettled([saveMemory(services, "alice", memory), saveMemory(services, "alice", memory)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(Object.keys(services.scenario.read().docs).length, count + 1);
  assert.equal((await services.docs.read(memoryIndexPath(entry("alice")))).document.links.length, 1);
});


test("automatically loaded memory indexes remain audited when their entry link is removed", async () => {
  const services = fixture();
  const before = await services.docs.read(entry("alice"));
  await services.docs.replace(before.path, before.sha, "[Memories](memories/index.md)", "");
  await assert.rejects(saveMemory(services, "alice", { ...memory, content: "[[gm.md]]" }), /validation/i);
  const index = await services.docs.read(memoryIndexPath(before.path));
  await assert.rejects(services.docs.replace(index.path, index.sha, "visibility: private", "visibility: gm"), /validation/i);
  assert.equal((await services.docs.read(index.path)).sha, index.sha);
});
