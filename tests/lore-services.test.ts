import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { CharacterPropertiesSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices, DocumentConflictError } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";

const entry = "Scenarios/Test/scenario.md";
const index = "Scenarios/Test/index.md";
const actor = "Scenarios/Test/Characters/alice/character.md";
function fixture() {
  const state = worldState(create(MapSchema, { day: 3 }), new Map([
    [entry, "Briefing"], [index, "Navigation"], [actor, "Alice"],
    ["note.md", "---\nvisibility: gm\n---\nFirst\nSecond\n"],
  ]), "Test", actor);
  state.docs[actor]!.characterProperties = create(CharacterPropertiesSchema);
  return state;
}

test("scenario and document reads are detached; SHA includes frontmatter and survives serialization", async () => {
  const input = fixture();
  const { scenario, docs } = createScenarioServices(input);
  input.docs["note.md"]!.body = "external edit";
  const first = await scenario.getDocument("note.md");
  assert.match(first.sha, /^[a-f0-9]{64}$/);
  first.document.frontmatter!.visibility = "public";
  scenario.snapshot().docs["note.md"]!.body = "external edit";
  scenario.info().characters.push("external.md");
  const reread = await docs.read("note.md");
  assert.equal(reread.document.frontmatter!.visibility, "gm");
  assert.equal(reread.sha, first.sha);
  assert.deepEqual(scenario.info(), { scenario: entry, scenarioIndex: index, player: actor, characters: [] });
  const changed = await docs.replace("note.md", first.sha, "visibility: gm", "visibility: private");
  assert.notEqual(changed.sha, first.sha);
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, scenario.snapshot())));
  assert.equal((await restored.docs.read("note.md")).sha, changed.sha);
  await assert.rejects(docs.read("missing.md"), /not found/);
});

test("create, replace, insert and delete preserve properties and rebuild scenario references", async () => {
  const { scenario, docs } = createScenarioServices(fixture());
  const added = await docs.create("new.md", "---\nvisibility: public\n---\nSecret");
  added.document.body = "external edit";
  const actorBefore = await docs.read(actor);
  const actorAfter = await docs.replace(actor, actorBefore.sha, "Alice", "Alice [[new]]");
  assert.deepEqual(actorAfter.document.characterProperties, actorBefore.document.characterProperties);
  assert.equal(actorAfter.document.links[0]!.target, "new.md");
  await docs.insert(entry, (await docs.read(entry)).sha, 1, `[[${actor}]]`);
  assert.deepEqual(scenario.info().characters, [actor]);
  const edited = await docs.insert("new.md", (await docs.read("new.md")).sha, 3, "Heading");
  assert.equal(edited.document.body, "Heading\nSecret");
  await docs.replace(actor, actorAfter.sha, " [[new]]", "");
  await docs.delete("new.md", edited.sha);
  await assert.rejects(docs.read("new.md"), /not found/);
  assert.equal(scenario.snapshot().map!.day, 3);
});

test("concurrent edits using the same SHA have exactly one winner; failure does not block writes", async () => {
  const { docs } = createScenarioServices(fixture());
  const before = await docs.read("note.md");
  const results = await Promise.allSettled([
    docs.replace("note.md", before.sha, "First", "Winner"),
    docs.replace("note.md", before.sha, "Second", "Loser"),
  ]);
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  if (results[1]!.status === "rejected") assert.ok(results[1].reason instanceof DocumentConflictError);
  await assert.rejects(docs.delete("note.md", before.sha), DocumentConflictError);
  const current = await docs.read("note.md");
  assert.match(current.text, /Winner\nSecond/);
  await docs.delete("note.md", current.sha);
});

test("invalid graph, protected references and malformed edits fail without mutating state", async () => {
  const { scenario, docs } = createScenarioServices(fixture());
  await docs.create("A/Secret.md", "Secret");
  await docs.create("reader.md", "[[Secret]]");
  const before = scenario.snapshot();
  const note = await docs.read("note.md");
  const failures = [
    () => docs.create("B/Secret.md", "Ambiguous"),
    () => docs.create("../bad.md", "Bad path"),
    () => docs.create("note.md", "Already exists"),
    () => docs.replace("note.md", note.sha, "First", "[[Missing]]"),
    () => docs.replace("note.md", note.sha, "gm", "["),
    () => docs.replace("note.md", note.sha, "", "Empty"),
    () => docs.replace("note.md", note.sha, "absent", "None"),
    () => docs.replace("note.md", note.sha, "\n", "Ambiguous"),
    () => docs.insert("note.md", note.sha, -1, "Invalid"),
    () => docs.insert("note.md", note.sha, 99, "Invalid"),
    ...[entry, index, actor, "A/Secret.md"].map(path => async () => docs.delete(path, (await docs.read(path)).sha)),
  ];
  for (const operation of failures) {
    await assert.rejects(operation());
    assert.deepEqual(scenario.snapshot(), before);
  }
});

test("insert handles empty documents, final newlines and SHA ignores object key order", async () => {
  const { docs } = createScenarioServices(fixture());
  const empty = await docs.create("empty.md", "");
  const line = await docs.insert("empty.md", empty.sha, 0, "One\n");
  const two = await docs.insert("empty.md", line.sha, 1, "Two");
  assert.equal(two.text, "One\nTwo");
  const a = await docs.create("a.md", "---\na: 1\nb: 2\n---\nBody");
  const b = await docs.create("b.md", "---\nb: 2\na: 1\n---\nBody");
  assert.equal(a.sha, b.sha);
  assert.equal(a.text, b.text);
  const separator = await docs.create("separator.md", "---\n{}\n---\n---\nBody");
  const changed = await docs.replace("separator.md", separator.sha, "Body", "Edited");
  assert.equal(changed.document.body, "---\nEdited");
});
