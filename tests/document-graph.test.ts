import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { DocumentGraph } from "../packages/lore/src/document-graph.js";
import { refreshDocumentGraph, worldState } from "../packages/lore/src/world-state.js";

const entry = "Scenarios/Test/scenario.md", index = "Scenarios/Test/index.md";
function fixture() {
  return createScenarioServices(worldState(create(MapSchema), new Map([
    [entry, "Briefing"], [index, "Index"], ["A/Shared.md", "Original"],
    ["Readers/reader.md", "[[Shared#intro|Briefing]] [web](https://example.com) [self](#intro)"],
  ]), "Test"));
}
function matchesFreshGraph(services: ReturnType<typeof fixture>) {
  assert.deepEqual(services.scenario.snapshot(), refreshDocumentGraph(services.scenario.snapshot()));
}

test("adding and removing names re-resolves cached shorthand links and updates reader SHAs", async () => {
  const services = fixture(), { docs } = services;
  const target = async () => (await docs.read("Readers/reader.md")).document.links[0]!.target;
  const before = await docs.read("Readers/reader.md");
  assert.equal(await target(), "A/Shared.md");
  // A local name takes precedence over a suffix match.
  const local = await docs.create("Readers/Shared.md", "Local");
  assert.equal(await target(), local.path);
  assert.notEqual((await docs.read(before.path)).sha, before.sha);
  matchesFreshGraph(services);
  // A vault-root name takes precedence over a local name.
  const root = await docs.create("Shared.md", "Root");
  assert.equal(await target(), root.path);
  matchesFreshGraph(services);
  await docs.delete(root.path, root.sha);
  assert.equal(await target(), local.path);
  await docs.delete(local.path, local.sha);
  assert.equal(await target(), "A/Shared.md");
  assert.equal((await docs.read(before.path)).sha, before.sha);
  matchesFreshGraph(services);
});

test("dangling deletions and ambiguous additions are atomic and do not poison cached links", async () => {
  const services = fixture(), { docs, scenario } = services;
  const before = scenario.snapshot(), original = await docs.read("A/Shared.md");
  await assert.rejects(docs.delete(original.path, original.sha), /No matching vault note/);
  await assert.rejects(docs.create("B/Shared.md", "Ambiguous"), /Matches/);
  assert.deepEqual(scenario.snapshot(), before);
  // Remove the inbound link, then delete and recreate the formerly referenced file.
  const reader = await docs.read("Readers/reader.md");
  await docs.replace(reader.path, reader.sha, "[[Shared#intro|Briefing]]", "No briefing");
  await docs.delete(original.path, original.sha);
  await docs.create(original.path, `[[${index}]]`);
  assert.deepEqual((await docs.read(original.path)).document.links.map(link => link.target), [index]);
  matchesFreshGraph(services);
});

test("failed edits leave the published cache intact and new bodies remove obsolete links", async () => {
  const services = fixture(), { docs, scenario } = services;
  const reader = await docs.read("Readers/reader.md"), before = scenario.snapshot();
  await assert.rejects(docs.replace(reader.path, reader.sha, "[[Shared#intro|Briefing]]", "[[Missing]]"), /No matching/);
  assert.deepEqual(scenario.snapshot(), before);
  const updated = await docs.replace(reader.path, reader.sha, "[[Shared#intro|Briefing]]", `[index](../${index})`);
  assert.equal(updated.document.links[0]!.target, index);
  const original = await docs.read("A/Shared.md");
  await docs.delete(original.path, original.sha);
  matchesFreshGraph(services);
  // Detached returned links must not corrupt the cache used on the next write.
  updated.document.links[0]!.target = "Missing.md";
  await docs.create("unrelated.md", "Unrelated");
  assert.equal((await docs.read(reader.path)).document.links[0]!.target, index);
  matchesFreshGraph(services);
});

test("namespace changes still reject redirects into inaccessible documents", async () => {
  const actor = "Scenarios/Test/Characters/alice/character.md";
  const { docs, scenario } = createScenarioServices(worldState(create(MapSchema), new Map([
    [entry, `[[${actor}]]`], [index, "Index"], [actor, "[[Shared]]"],
    ["A/Shared.md", "---\nvisibility: public\n---\nPublic history"],
  ]), "Test"));
  const before = scenario.snapshot();
  await assert.rejects(docs.create("Shared.md", "---\nvisibility: gm\n---\nPrivate history"), /Document validation failed/);
  assert.deepEqual(scenario.snapshot(), before);
  await docs.create("Shared.md", "---\nvisibility: public\n---\nPublic replacement");
  assert.equal((await docs.read(actor)).document.links[0]!.target, "Shared.md");
});

test("physical commits never rebuild the document graph and failed commits remain atomic", t => {
  const { mechanics, scenario } = fixture();
  const graphUpdates = t.mock.method(DocumentGraph.prototype, "update");
  const before = scenario.snapshot();
  mechanics.commit(create(MapSchema, { day: 2 }), {});
  assert.deepEqual(scenario.snapshot().docs, before.docs);
  assert.equal(graphUpdates.mock.callCount(), 0);
  const committed = scenario.snapshot();
  assert.throws(() => mechanics.commit(create(MapSchema, { day: 3 }), { "missing.md": {} as never }), /Unknown character/);
  assert.deepEqual(scenario.snapshot(), committed);
});
