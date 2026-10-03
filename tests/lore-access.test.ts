import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditLore } from "../scripts/lib/lore-access.js";

const entry = "Scenarios/Test/Characters/aldren/character.md";
function fixture(t: test.TestContext, files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "lore-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), body);
  }
  return root;
}
const publicNote = "---\nvisibility: public\n---\n";
const privateNote = "---\nvisibility: private\nreaders: ['character:aldren']\n---\n";

test("traces private, GM-only, sibling and unclassified notes through cycles", t => {
  const root = fixture(t, {
    [entry]: "[[Cast/Aldren/private]] [[background]]",
    "Cast/Aldren/private.md": privateNote + "[[gm]] [[knowledge/Corvin]]",
    "Cast/Aldren/gm.md": "---\nvisibility: gm\n---\n[[World/Secret]]",
    "Cast/Aldren/knowledge/Corvin.md": privateNote + `[[${entry}]]`,
    "World/Secret.md": "An unclassified secret.",
    "Scenarios/Test/Characters/aldren/background.md": "[[Scenarios/Test/Characters/corvin/character]]",
    "Scenarios/Test/Characters/corvin/character.md": "Other character.",
  });
  const findings = auditLore(root, entry, { character: "aldren" });
  assert.equal(findings.length, 3);
  assert.ok(findings.every(item => item.kind === "denied"));
  assert.deepEqual(findings.find(item => item.trail.at(-1) === "World/Secret.md")?.trail,
    [entry, "Cast/Aldren/private.md", "Cast/Aldren/gm.md", "World/Secret.md"]);
});

test("public, character, faction and playthrough grants are explicit; GM cannot be granted", t => {
  const root = fixture(t, {
    [entry]: "[[Public]] [[Faction]] [[Found]] [[GM]]",
    "Public.md": publicNote,
    "Faction.md": "---\nvisibility: private\nreaders: ['faction:caerwyn']\n---\n",
    "Found.md": "---\nvisibility: private\n---\n",
    "GM.md": "---\nvisibility: gm\n---\n",
  });
  assert.equal(auditLore(root, entry, { character: "aldren" }).length, 3);
  assert.deepEqual(auditLore(root, entry, { character: "aldren", factions: ["caerwyn"], grants: ["Found.md", "GM.md"] }).map(item => item.trail.at(-1)), ["GM.md"]);
});

test("follows Markdown, reference links, wiki aliases, embeds and anchors but ignores code and external URLs", t => {
  const root = fixture(t, {
    [entry]: '[public](../../../../World/Public%20Note.md#heading) ![[World/Secret|alias]]\n[ref][secret]\n\n[secret]: /World/Other.md\n\n`[[Missing]]`\n```md\n[[MissingToo]]\n```\n<!-- [[Hidden]] -->\n[web](https://example.com)\n[[#local]]',
    "World/Public Note.md": publicNote,
    "World/Secret.md": "Secret",
    "World/Other.md": "Other secret",
  });
  assert.deepEqual(auditLore(root, entry, { character: "aldren" }).map(item => [item.kind, item.trail.at(-1)]),
    [["denied", "World/Secret.md"], ["denied", "World/Other.md"]]);
});

test("reports ambiguous, missing and escaping links without selecting an arbitrary note", t => {
  const root = fixture(t, {
    [entry]: "[[Duplicate]] [[Missing]] [escape](../../../../../outside.md)",
    "One/Duplicate.md": publicNote,
    "Two/Duplicate.md": publicNote,
  });
  assert.deepEqual(auditLore(root, entry, { character: "aldren" }).map(item => item.kind), ["ambiguous", "broken", "broken"]);
});

test("invalid metadata fails closed, including malformed YAML and reader lists", t => {
  for (const header of ["visibility: [public]", "visibility: pubic", "visibility: private\nreaders: {characters: aldren}", "visibility: private\nreaders: {character: aldren}", "visibility: [", "visibility: public\nvisibility: private"]) {
    const root = fixture(t, { [entry]: `---\n${header}\n---\n` });
    assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.kind, "invalid");
  }
});

test("checks entry access, excludes navigation indexes and rejects a mismatched character", t => {
  const root = fixture(t, {
    [entry]: "[[Scenarios/Test/Characters/aldren/index]]",
    "Scenarios/Test/Characters/aldren/index.md": "Author navigation",
  });
  assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.kind, "denied");
  assert.throws(() => auditLore(root, entry, { character: "corvin" }), /Entry must/);
  writeFileSync(path.join(root, entry), "---\nvisibility: gm\n---\n");
  assert.deepEqual(auditLore(root, entry, { character: "aldren" })[0]?.trail, [entry]);
});

test("entry labels grant shared knowledge without propagating labels from retrieved notes", t => {
  const root = fixture(t, {
    [entry]: "---\nlabels: [court-informed]\n---\n[[Briefing]]",
    "Briefing.md": "---\nvisibility: private\nlabels: [secret]\nreaders: ['label:court-informed']\n---\n[[Secret]] [[GM]]",
    "Secret.md": "---\nvisibility: private\nreaders: ['label:secret']\n---\n",
    "GM.md": "---\nvisibility: gm\nreaders: ['label:court-informed']\n---\n",
  });
  assert.deepEqual(auditLore(root, entry, { character: "aldren" }).map(item => item.trail.at(-1)),
    ["Secret.md", "GM.md"]);
  writeFileSync(path.join(root, entry), "[[Briefing]]");
  assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.trail.at(-1), "Briefing.md");
});

test("malformed document and reader labels fail closed", t => {
  for (const header of ["labels: court-informed", "labels: [42]", "labels: [' ']",
    "visibility: public\nreaders: {labels: court-informed}"]) {
    const root = fixture(t, { [entry]: `---\n${header}\n---\n` });
    assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.kind, "invalid");
  }
});

test("flat reader lists distinguish namespaces and accept any matching grant", t => {
  const root = fixture(t, {
    [entry]: "[[Shared]]",
    "Shared.md": "---\nvisibility: private\nreaders: ['character:other', 'faction:court', 'label:informed']\n---\n",
  });
  assert.equal(auditLore(root, entry, { character: "aldren" }).length, 1);
  for (const audience of [
    { character: "aldren", factions: ["court"] },
    { character: "aldren", labels: ["informed"] },
  ]) assert.deepEqual(auditLore(root, entry, audience), []);
  for (const audience of [
    { character: "aldren", labels: ["court"] },
    { character: "aldren", factions: ["informed"] },
    { character: "aldren", labels: ["Informed"] },
  ]) assert.equal(auditLore(root, entry, audience)[0]?.kind, "denied");
  writeFileSync(path.join(root, "Shared.md"), "---\nvisibility: private\nreaders:\n  - character:aldren\n  - label:informed\n---\n");
  assert.deepEqual(auditLore(root, entry, { character: "aldren" }), []);
  writeFileSync(path.join(root, "Shared.md"), "---\nvisibility: private\nreaders: []\n---\n");
  assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.kind, "denied");
});

test("nested, unprefixed and malformed readers fail closed even with a valid grant", t => {
  for (const readers of [
    "{characters: [aldren]}", "{labels: [court-informed]}", "character:aldren", "null",
    "[42]", "['']", "['character:']", "['label: ']", "['characters:aldren']",
    "['character:aldren', 'unknown:any']", "['character:aldren', 'label:two words']",
    "['character:aldren', 'label:nested:value']", "['character:aldren', {label: informed}]",
  ]) {
    for (const visibility of ["private", "public", "gm"]) {
      const root = fixture(t, { [entry]: `---\nvisibility: ${visibility}\nreaders: ${readers}\n---\n` });
      assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.kind, "invalid", readers);
    }
  }
});

test("authored entry factions grant access without inheriting membership from retrieved notes", t => {
  const root = fixture(t, {
    [entry]: "---\nfactions: [nine-furrows]\n---\n[[Academic]]",
    "Academic.md": "---\nvisibility: private\nreaders: ['faction:nine-furrows']\nfactions: [caerwyn]\n---\n[[Royal]] [[GM]]",
    "Royal.md": "---\nvisibility: private\nreaders: ['faction:caerwyn']\n---\n",
    "GM.md": "---\nvisibility: gm\nreaders: ['faction:nine-furrows']\n---\n",
  });
  assert.deepEqual(auditLore(root, entry, { character: "aldren" }).map(finding => finding.trail.at(-1)), ["Royal.md", "GM.md"]);
  for (const value of ["nine-furrows", "[42]", "null"]) {
    writeFileSync(path.join(root, entry), `---\nfactions: ${value}\n---\n[[Academic]]`);
    assert.equal(auditLore(root, entry, { character: "aldren" })[0]?.kind, "invalid");
  }
});
