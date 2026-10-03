import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { ItemInstanceSchema, WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { type Note } from "../packages/lore/src/vault.js";
import { readLore } from "../packages/lore/src/read-lore.js";
import { worldState } from "../packages/lore/src/world-state.js";

const entry = "Scenarios/Test/scenario.md";
const character = "Scenarios/Test/Characters/alice/character.md";
const note = (body: string, metadata = {}): Note => ({ body, metadata });

test("builds independent, serializable documents and scenario entrypoints without expanding lore", () => {
  const body = "[[Secrets#Truth|Read later]] [self](#opening) [web](https://example.com) `[[Ignored]]`";
  const lore = new Map([
    [entry, note(`[[${character}]] [[${character}|Alice]]`)],
    [character, note(body, { visibility: "private", readers: { characters: ["alice"] } })],
    ["Secrets.md", note("A GM-only truth. [[Secrets]]", { visibility: "gm" })],
    ["Scenarios/Other/Characters/bob/character.md", note("This is a stub.")],
  ]);
  const map = create(MapSchema, { day: 2, facts: { test: true } });
  const state = worldState(map, lore, "Test");
  assert.deepEqual(state.characters, [character]);
  assert.equal(state.scenario, entry);
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
  assert.equal(lore.get(character)!.metadata.visibility, "private");
  assert.equal(worldState(map, lore, "Test").docs[character]!.body, body);
});

test("reports missing scenarios, invalid YAML and unresolved or ambiguous document links", () => {
  const map = create(MapSchema);
  assert.throws(() => worldState(map, new Map(), "Test"), /Missing scenario/);
  assert.throws(() => worldState(map, new Map(), "../Test"), /directory name/);
  for (const [body, extra, expected] of [
    ["[[Missing]]", [], /scenario.md:.*No matching/],
    ["[[Same]]", [["A/Same.md", note("")], ["B/Same.md", note("")]], /scenario.md:.*Matches/],
  ] as const) {
    assert.throws(() => worldState(map, new Map<string, Note>([[entry, note(body)], ...extra]), "Test"), expected);
  }
  assert.throws(() => worldState(map, new Map([[entry, { ...note(""), error: "Invalid YAML" }]]), "Test"), /scenario.md:.*Invalid YAML/);
});

test("builds the current vault including stubs and authored stat sheets", () => {
  const lore = readLore(fileURLToPath(new URL("../lore/", import.meta.url)));
  const state = worldState(create(MapSchema), lore, "Centennial Assembly");
  assert.equal(Object.keys(state.docs).length, lore.size);
  assert.equal(state.characters.length, 12);
  assert.equal(state.docs["Scenarios/Centennial Assembly/Map/Assembly Map.md"]!.body.trim(), "This is a stub.");
  assert.ok(state.characters.includes("Scenarios/Centennial Assembly/Characters/aldren/character.md"));
  for (const entry of state.characters) {
    const properties = state.docs[entry]!.characterProperties!;
    assert.ok(properties.dnd?.abilityScores, entry);
    assert.ok(properties.inventory, entry);
  }
  assert.deepEqual(toJson(WorldStateSchema, fromJson(WorldStateSchema, toJson(WorldStateSchema, state))), toJson(WorldStateSchema, state));
});

test("loads optional sidecars, preserving unauthored versus empty mechanics and isolating edits", t => {
  const root = mkdtempSync(path.join(tmpdir(), "lore-world-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, path.dirname(character)), { recursive: true });
  writeFileSync(path.join(root, entry), `[[${character}]]`);
  writeFileSync(path.join(root, character), "This is a stub.");
  const build = () => worldState(create(MapSchema), readLore(root), "Test");
  assert.equal(build().docs[character]!.characterProperties, undefined);
  const sidecar = path.join(root, path.dirname(character), "properties.json");
  writeFileSync(sidecar, JSON.stringify({ dnd: null, inventory: {} }));
  const state = build();
  assert.equal(state.docs[character]!.characterProperties!.dnd, undefined);
  assert.equal(state.docs[character]!.characterProperties!.inventory!.items.length, 0);
  state.docs[character]!.characterProperties!.inventory!.items.push(create(ItemInstanceSchema, { id: "changed" }));
  assert.deepEqual(build().docs[character]!.characterProperties!.inventory!.items, []);
  for (const invalid of ['{', 'null', '{"dnd":{"bogus":true}}']) {
    writeFileSync(sidecar, invalid);
    assert.throws(build, /properties.json/);
  }
});
