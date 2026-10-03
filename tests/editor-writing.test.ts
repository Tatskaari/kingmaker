import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { collaborationBrief, updateWriting, writingView, type Story } from "../apps/editor/src/writing.js";
import { DiskDocument } from "../apps/editor/src/file-sync.js";

test("writing edits preserve the full scenario outside the chosen authored field", () => {
  const original = JSON.parse(readFileSync("content/scenarios/last-night.json", "utf8")) as Story;
  const edited = structuredClone(original);
  updateWriting(edited, "characters.0.parkedObjectives.0.successCriteria", "Earn a public promise.");
  assert.equal(edited.characters[0]!.parkedObjectives![0]!.successCriteria, "Earn a public promise.");
  edited.characters[0]!.parkedObjectives![0]!.successCriteria = original.characters[0]!.parkedObjectives![0]!.successCriteria!;
  assert.deepEqual(edited, original);
});

test("story links and collaboration context include incoming relationships and relevant notes", () => {
  const story: Story = { characters: [{ id: "a", name: "<script>" }, { id: "b", name: "B", relationships: [{ characterId: "a", description: "Trusts A" }] }], notes: [{ id: "secret", text: "Secret", characterIds: ["a"] }, { id: "other", text: "Unrelated", characterIds: ["b"] }] };
  const view = writingView(story, "characters", "a", "");
  assert.ok(view.includes("&lt;script&gt;"));
  assert.ok(!view.includes("<script>"));
  assert.ok(view.includes("Trusts A"));
  const brief = collaborationBrief(story, "a");
  assert.ok(brief.includes("Trusts A"));
  assert.ok(brief.includes("Secret"));
  assert.ok(!brief.includes("Unrelated"));
});

async function connectedDocument() {
  let text = '{"name":"Original"}', writes = 0;
  let beforeClose: () => void = () => {};
  const doc = new DiskDocument<{ name: string }>("scenario");
  doc.handle = {
    name: "scenario.json",
    getFile: async () => ({ text: async () => text, lastModified: 1, name: "scenario.json" }),
    createWritable: async () => {
      let next = "";
      return { write: async (value: string) => { writes += 1; next = value; }, close: async () => { beforeClose(); text = next; } };
    },
  } as unknown as FileSystemFileHandle;
  await doc.reload();
  return { doc, disk: () => text, writes: () => writes, externalEdit: (value: string) => { text = value; }, onClose: (callback: () => void) => { beforeClose = callback; } };
}

test("save detects external changes before polling and edits cannot clear the conflict", async () => {
  const { doc, externalEdit, writes } = await connectedDocument();
  doc.change(value => { value.name = "Local"; });
  externalEdit('{"name":"External"}');
  await doc.save();
  assert.equal(doc.conflict, true);
  doc.change(value => { value.name = "Still local"; });
  await doc.save();
  assert.equal(doc.conflict, true);
  assert.equal(writes(), 0);
  await doc.reload();
  assert.equal(doc.value?.name, "External");
});

test("edits during a save remain dirty and queued saves write the latest text", async () => {
  const { doc, onClose, disk, writes } = await connectedDocument();
  doc.change(value => { value.name = "First"; });
  onClose(() => { onClose(() => {}); doc.change(value => { value.name = "Second"; }); });
  await doc.save();
  assert.equal(doc.dirty, true);
  await Promise.all([doc.save(), doc.save()]);
  assert.equal(doc.dirty, false);
  assert.equal(JSON.parse(disk()).name, "Second");
  assert.equal(writes(), 2);
});

test("external reload checks file contents even when timestamps are identical", async () => {
  const { doc, externalEdit } = await connectedDocument();
  externalEdit('{"name":"External"}');
  await doc.checkDisk();
  assert.equal(doc.value?.name, "External");
});
