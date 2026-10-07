import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { MapStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { DocumentValidationError } from "../packages/lore/src/document-audit.js";
import { worldState } from "../packages/lore/src/world-state.js";

const entry = "Scenarios/Test/Characters/alice/character.md";
const shared = "---\nvisibility: private\nreaders: ['label:court']\n---\n";
function fixture() {
  return createScenarioServices(worldState(create(MapSchema), new Map([
    ["Scenarios/Test/scenario.md", `[[${entry}]]`], ["Scenarios/Test/index.md", "Index"],
    [entry, "---\nlabels: [court]\n---\n[[Shared]]"],
    ["Shared.md", shared + "Public history."], ["GM.md", "---\nvisibility: gm\n---\nSECRET_SENTINEL"],
    ["A/Duplicate.md", ""], ["B/Duplicate.md", ""],
  ]), "Test"));
}

test("every create, replace, insert and delete validates atomically without an explicit audit", async () => {
  const { docs, scenario } = fixture(), before = scenario.read();
  const note = await docs.read("Shared.md"), character = await docs.read(entry);
  for (const operation of [
    () => docs.create("unused.md", "---\nreaders: {character: alice}\n---\n"),
    () => docs.create("unused.md", "[[Missing]]"),
    () => docs.replace(note.path, note.sha, "Public history.", "[[Duplicate]]"),
    () => docs.replace(note.path, note.sha, "private", "gm"),
    () => docs.replace(entry, character.sha, "- court", "- elsewhere"),
    () => docs.insert(note.path, note.sha, 0, "[[GM]]\n"),
    () => docs.delete(note.path, note.sha),
  ]) {
    await assert.rejects(operation());
    assert.deepEqual(scenario.read(), before);
  }
  await assert.rejects(docs.replace(note.path, note.sha, "Public history.", "[[GM]]"), error => {
    assert.ok(error instanceof DocumentValidationError);
    assert.ok(error.findings.some(f => f.kind === "denied" && JSON.stringify(f.trail) === JSON.stringify([entry, "Shared.md", "GM.md"])));
    assert.ok(!error.message.includes("SECRET_SENTINEL"));
    return true;
  });
  // A rejected write leaves the SHA usable and does not poison the queue.
  await docs.replace(note.path, note.sha, "Public history.", `Public history. [[${entry}]]`);
});

test("revoking access requires removing the link first", async () => {
  const { docs } = fixture();
  const character = await docs.read(entry);
  await assert.rejects(docs.replace(entry, character.sha, "- court", "- elsewhere"), DocumentValidationError);
  const unlinked = await docs.replace(entry, character.sha, "[[Shared]]", "No shared briefing.");
  await docs.replace(entry, unlinked.sha, "- court", "- elsewhere");
  const note = await docs.read("Shared.md");
  await docs.delete(note.path, note.sha);
});

test("existing defects cannot bypass validation on unrelated edits", async () => {
  const source = fixture().scenario.read();
  source.docs["Shared.md"]!.body += " [[GM]]";
  const { docs, scenario } = createScenarioServices(source), before = scenario.read();
  await assert.rejects(docs.create("unrelated.md", "A new note."), DocumentValidationError);
  assert.deepEqual(scenario.read(), before);
  const note = await docs.read("Shared.md");
  await docs.replace(note.path, note.sha, " [[GM]]", "");
  await docs.create("unrelated.md", "A new note.");
});
