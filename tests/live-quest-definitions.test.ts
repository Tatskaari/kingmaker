import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import { callDocumentTool } from "../packages/conversation/src/document-tools.js";

const path = "Conversations/aldren.md", id = "conversation-aldren-cushions";

test("tree edits publish a compiled graph with unchanged progress, activation and history", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  await services.quests.transition(id, "greeted", 0, "Greeting heard");
  const before = services.quests.read(id), unrelated = services.currentWorld().quests.assembly_programme;
  const doc = await services.docs.read(path);
  await services.docs.replace(path, doc.sha, "Hint that something very dire has happened.", "Explain the changed plan.");
  const after = services.quests.read(id);
  assert.equal(after.quest!.stages.find(stage => stage.id === "hint")!.description, "Explain the changed plan.");
  assert.equal(after.currentStageId, before.currentStageId);
  assert.equal(after.active, before.active);
  assert.deepEqual(after.history, before.history);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(services.currentWorld().quests.assembly_programme, unrelated);
  await assert.rejects(services.quests.transition(id, "hinted", before.revision), /quest changed/);
});

test("invalid graph or removal of the current node leaves documents and quest state unchanged", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const before = services.quests.read(id), doc = await services.docs.read(path);
  for (const text of [doc.text.replace("greeted -> hint", "greeted -> missing"),
    doc.text.replaceAll("greeting", "renamed"), doc.text.replace("initial: greeting", "initial: absent")]) {
    await assert.rejects(services.docs.commit([{ path, expectedSha: doc.sha, text }]), /Document validation/);
    assert.deepEqual(await services.docs.read(path), doc);
    assert.deepEqual(services.quests.read(id), before);
  }
  await assert.rejects(services.docs.delete(path, doc.sha), /cannot remove a live conversation/);
  const result = await callDocumentTool(services.docs, "replace_document", { path, expectedSha: doc.sha,
    oldText: "greeted -> hint", newText: "greeted -> missing" });
  assert.equal(result.ok, false);
  assert.equal("error" in result && result.error, "document_validation");
});

test("batch drafts compile together and a failure publishes none of their edits", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const doc = await services.docs.read(path), notePath = "Scenarios/Centennial Assembly/Characters/aldren/situation.md";
  const note = await services.docs.read(notePath);
  await assert.rejects(services.docs.commit([
    { path: notePath, expectedSha: note.sha, text: note.text + "\nA changed plan.\n" },
    { path, expectedSha: doc.sha, text: doc.text.replaceAll("greeting", "removed") },
  ]), /cannot remove current node/);
  assert.deepEqual(await services.docs.read(notePath), note);
  const added = doc.text.replace("greeted -> hint", "greeted -> report") + "\n## Node: report\n### Guidance\nReport back to the player.\n";
  await services.docs.commit([{ path, expectedSha: doc.sha, text: added }]);
  assert.equal(services.quests.availableTransitions(id)[0]!.toStageId, "report");
});

test("quest document edits recompile definitions without resetting stage or activation", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const quest = services.quests.read("assembly_programme");
  const stagePath = Object.entries(services.currentWorld().docs).find(([path, doc]) => path.includes("/Quests/") && path.endsWith("/quest.md") && doc.frontmatter?.id === quest.quest!.id)![0];
  const doc = await services.docs.read(stagePath);
  await services.docs.replace(stagePath, doc.sha, "Aldren wants his pillows.", "Aldren wants his pillows. Include the player in the report.");
  const after = services.quests.read("assembly_programme");
  assert.equal(after.currentStageId, quest.currentStageId);
  assert.equal(after.active, quest.active);
  assert.match(after.quest!.stages.find(stage => stage.id === quest.currentStageId)!.description, /Include the player/);
  assert.equal(after.revision, quest.revision + 1);
});

test("quest graph deletion, ID changes and current-node removal leave live progress intact", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const path = "Scenarios/Centennial Assembly/Quests/Assembly Programme/quest.md";
  const doc = await services.docs.read(path), before = services.quests.read("assembly_programme");
  const indexPath = path.replace("quest.md", "index.md"), index = await services.docs.read(indexPath);
  await services.docs.replace(indexPath, index.sha,
    "[[Scenarios/Centennial Assembly/Quests/Assembly Programme/quest|Quest graph]]", "Quest graph");
  await assert.rejects(services.docs.delete(path, doc.sha), /cannot remove a live quest/);
  for (const text of [doc.text.replace("id: assembly_programme", "id: renamed"),
    doc.text.replaceAll("investigate_missing_pillows", "removed")]) {
    await assert.rejects(services.docs.commit([{ path, expectedSha: doc.sha, text }]), /Document validation/);
  }
  assert.deepEqual(await services.docs.read(path), doc);
  assert.deepEqual(services.quests.read("assembly_programme"), before);
});
