import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditLore, readVault } from "../scripts/lib/lore-access.js";

const vault = fileURLToPath(new URL("../lore/", import.meta.url));
const notes = readVault(vault);
const entries = [...notes.keys()].filter(name => /^Scenarios\/.+\/Characters\/[^/]+\/character\.md$/.test(name));

test("the vault contains scenario character entrypoints to audit", () => {
  assert.ok(entries.length > 0, "No scenario character entries found; the access check must not silently skip the vault");
});

for (const entry of entries) {
  test(`character lore links stay within permitted knowledge: ${entry}`, () => {
    const character = path.posix.basename(path.posix.dirname(entry));
    const findings = auditLore(vault, entry, { character });
    assert.equal(findings.length, 0, findings.map(finding =>
      `${finding.kind}: ${finding.detail}\n  ${finding.trail.join("\n  -> ")}`).join("\n\n"));
  });
}

test("every cast member has private characterization, GM notes and observer-owned knowledge of all others", () => {
  const cast = [...notes.keys()].filter(name => /^Cast\/[^/]+\/[^/]+\/private\.md$/.test(name));
  assert.ok(cast.length > 0);
  const owners = new Set<string>();
  for (const name of cast) {
    const directory = path.posix.dirname(name), metadata = notes.get(name)!.metadata;
    const readers = metadata.readers as { characters: string[]; factions?: string[] };
    assert.equal(metadata.visibility, "private", name);
    assert.equal(readers.characters.length, 1, name);
    assert.equal(readers.factions?.length ?? 0, 0, name);
    const owner = readers.characters[0]!;
    assert.ok(!owners.has(owner), `Duplicate cast owner: ${owner}`);
    owners.add(owner);
    assert.equal(notes.get(`${directory}/gm.md`)?.metadata.visibility, "gm", directory);
    assert.ok(notes.has(`${directory}/index.md`), directory);
    assert.ok(notes.has(`${directory}/knowledge/index.md`), directory);
    for (const other of cast) {
      if (other === name) continue;
      const knowledge = `${directory}/knowledge/${path.posix.basename(path.posix.dirname(other))}.md`;
      assert.equal(notes.get(knowledge)?.metadata.visibility, "private", knowledge);
      assert.deepEqual(notes.get(knowledge)?.metadata.readers, { characters: [owner] }, knowledge);
    }
  }
  for (const entry of entries) assert.ok(owners.has(path.posix.basename(path.posix.dirname(entry))), `Missing cast owner for ${entry}`);
});
