import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { readVault } from "../scripts/lib/lore-access.js";
import { worldState } from "../packages/lore/src/world-state.js";

const entry = "Scenarios/Test/scenario.md";
const character = "Scenarios/Test/Characters/alice/character.md";
const index = "Scenarios/Test/index.md";
const note = (body: string, metadata = {}) => `---\n${JSON.stringify(metadata)}\n---\n${body}`;

test("builds independent, serializable documents and scenario entrypoints without expanding lore", () => {
  const body = "[[Secrets#Truth|Read later]] [self](#opening) [web](https://example.com) `[[Ignored]]`";
  const lore = new Map([
    [index, note("Scenario navigation")],
    [entry, note(`[[${character}]] [[${character}|Alice]]`)],
    [character, note(body, { visibility: "private", readers: { characters: ["alice"] } })],
    ["Secrets.md", note("A GM-only truth. [[Secrets]]", { visibility: "gm" })],
    ["Scenarios/Other/Characters/bob/character.md", note("This is a stub.")],
  ]);
  const map = create(MapSchema, { day: 2, facts: { test: true } });
  const state = worldState(map, lore, "Test", character);
  assert.deepEqual(state.characters, [character]);
  assert.equal(state.scenario, entry);
  assert.equal(state.scenarioIndex, index);
  assert.equal(state.player, character);
  assert.equal(state.docs[character]!.body, body);
  assert.deepEqual(state.docs[character]!.links.map(link => [link.target, link.source]),
    [["Secrets.md", "Secrets#Truth"], [character, "#opening"]]);
  assert.deepEqual(fromJson(WorldStateSchema, toJson(WorldStateSchema, state)), state);
  state.map!.day = 9;
  state.map!.facts!.test = false;
  state.docs[character]!.frontmatter!.visibility = "public";
  state.docs[character]!.body = "Edited by GM";
  assert.equal(map.day, 2);
  assert.equal(map.facts!.test, true);
  assert.ok(lore.get(character)!.includes('"visibility":"private"'));
  assert.equal(worldState(map, lore, "Test").docs[character]!.body, body);
  assert.equal(worldState(map, lore, "Test").player, undefined);
});

test("reports missing scenarios, invalid YAML and unresolved or ambiguous document links", () => {
  const map = create(MapSchema);
  assert.throws(() => worldState(map, new Map(), "Test"), /Missing scenario/);
  assert.throws(() => worldState(map, new Map(), "../Test"), /directory name/);
  for (const [body, extra, expected] of [
    ["[[Missing]]", [], /scenario.md:.*No matching/],
    ["[[Same]]", [["A/Same.md", note("")], ["B/Same.md", note("")]], /scenario.md:.*Matches/],
  ] as const) {
    assert.throws(() => worldState(map, new Map<string, string>([[index, note("")], [entry, note(body)], ...extra]), "Test"), expected);
  }
  assert.throws(() => worldState(map, new Map([[index, note("")], [entry, "---\nvisibility: [\n---\n"]]), "Test"), /scenario.md:/);
});

test("builds the current Markdown vault including stubs", () => {
  const root = fileURLToPath(new URL("../lore/", import.meta.url));
  const lore = new Map([...readVault(root).keys()].map(name => [name, readFileSync(path.join(root, name), "utf8")]));
  const state = worldState(create(MapSchema), lore, "Centennial Assembly");
  assert.equal(Object.keys(state.docs).length, lore.size);
  assert.equal(state.characters.length, 12);
  assert.equal(state.docs["Scenarios/Centennial Assembly/Map/Assembly Map.md"]!.body.trim(), "This is a stub.");
  assert.ok(state.characters.includes("Scenarios/Centennial Assembly/Characters/aldren/character.md"));
  assert.deepEqual(toJson(WorldStateSchema, fromJson(WorldStateSchema, toJson(WorldStateSchema, state))), toJson(WorldStateSchema, state));
});

test("requires resolvable scenario index and explicit player references", () => {
  const map = create(MapSchema);
  assert.throws(() => worldState(map, new Map([[entry, "Briefing"]]), "Test"), /Missing scenario index/);
  const lore = new Map([[entry, "Briefing"], [index, "Navigation"]]);
  assert.throws(() => worldState(map, lore, "Test", "Players/missing.md"), /Missing player document/);
  assert.throws(() => worldState(map, lore, "Test", ""), /Missing player document/);
  lore.set("Players/new.md", "# New player");
  const state = worldState(map, lore, "Test", "Players/new.md");
  assert.equal(state.player, "Players/new.md");
  assert.deepEqual(state.characters, []);
  assert.equal(fromJson(WorldStateSchema, toJson(WorldStateSchema, state)).player, state.player);
});
