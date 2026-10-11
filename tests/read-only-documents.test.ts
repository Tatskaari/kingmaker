import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import { callDocumentTool } from "../packages/conversation/src/document-tools.js";

test("host read-only roots protect every write while reads and queries remain available", async () => {
  const initial = loadPlayableWorld(), bootstrap = createScenarioServices(initial);
  const path = "docs/hooks/index.md";
  await bootstrap.docs.create(path, "---\nvisibility: gm\nsummary: Hook reference\n---\nReference.");
  const services = createScenarioServices(bootstrap.currentWorld(), { readOnlyRoots: ["docs/hooks"] });
  const before = await services.docs.read(path);
  for (const write of [
    () => services.docs.create(path, "Replacement"),
    () => services.docs.create("docs/hooks/shadow.md", "Shadow"),
    () => services.docs.replace(path, before.sha, "gm", "public"),
    () => services.docs.insert(path, before.sha, 0, "Inserted"),
    () => services.docs.delete(path, before.sha),
    () => services.docs.commit([{ path, expectedSha: before.sha, text: "Replacement" }]),
  ]) await assert.rejects(write, /read-only/);
  assert.deepEqual(await services.docs.read(path), before);
  assert.equal((await services.docs.query("SELECT path FROM docs WHERE path = 'docs/hooks/index.md'")).rows.length, 1);
  const result = await callDocumentTool(services.docs, "delete_document", { path, expectedSha: before.sha });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /read-only/);
  for (const alias of ["docs/./hooks/index.md", "docs/x/../hooks/index.md", "/docs/hooks/index.md", "docs\\hooks\\index.md"]) {
    await assert.rejects(services.docs.create(alias, "Bypass"), /canonical document path/);
  }
  await services.docs.create("docs/writable.md", "Writable");
});

test("a rejected batch publishes neither writable documents nor actor intents", async () => {
  const services = createScenarioServices(loadPlayableWorld(), { readOnlyRoots: ["docs/hooks"] });
  const path = services.scenario.info().scenario, before = await services.docs.read(path);
  const actor = Object.values(services.currentWorld().simulation!.runtimeCharacters)[0]!;
  const revision = actor.intentRevision;
  await assert.rejects(services.docs.commit([
    { path, expectedSha: before.sha, text: before.text + "\nChanged" },
    { path: "docs/hooks/new.md", expectedSha: null, text: "Injected" },
  ], [{ actorId: actor.id, expectedRevision: revision, activity: null, wait: null }]), /read-only/);
  assert.deepEqual(await services.docs.read(path), before);
  assert.equal(services.currentWorld().simulation!.runtimeCharacters[actor.id]!.intentRevision, revision);
});
