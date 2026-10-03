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
const privateNote = "---\nvisibility: private\nreaders:\n  characters: [aldren]\n---\n";

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
    "Faction.md": "---\nvisibility: private\nreaders:\n  factions: [caerwyn]\n---\n",
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
