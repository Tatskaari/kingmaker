import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import { callDocumentTool } from "../packages/conversation/src/document-tools.js";
import { compileHook } from "../packages/hooks/src/compiler.js";
const path = "Hooks/example.ts";
const source = 'export default async function run(services: HookServices): Promise<string> { return services.quests.read("assembly_programme").id; }\n';

test("hook source uses normal edit tools with exact source round trips and atomic validation", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const first = await services.docs.create(path, source);
  assert.equal(first.text, source);
  assert.equal(first.document.frontmatter?.visibility, "gm");
  const invalid = await callDocumentTool(services.docs, "replace_document", { path, expectedSha: first.sha, oldText: ".read(", newText: ".missing(" });
  assert.equal(invalid.ok, false);
  assert.match(JSON.stringify(invalid), /document_validation.*missing/);
  assert.equal((await services.docs.read(path)).sha, first.sha);
  const scene = await services.docs.read(services.scenario.info().scenario);
  await assert.rejects(services.docs.commit([
    { path: scene.path, expectedSha: scene.sha, text: scene.text + "\nDo not publish" },
    { path, expectedSha: first.sha, text: "export default 42" },
  ]), /Document validation/);
  assert.equal((await services.docs.read(scene.path)).sha, scene.sha);
  const next = await services.docs.insert(path, first.sha, 0, '// [[not a Markdown link]]\n');
  assert.equal(next.text, '// [[not a Markdown link]]\n' + source);
  await assert.rejects(services.docs.replace(path, first.sha, "run", "changed"), /changed/);
  const resumed = createScenarioServices(services.currentWorld());
  assert.equal((await resumed.docs.read(path)).text, next.text);
  await resumed.docs.delete(path, next.sha);
});

test("compiler validates entrypoint, signatures and imports without executing source", () => {
  for (const source of ['export default 42', 'export default async () => 42', 'import x from "fs"; export default async () => "ok"', 'export default async () => fetch("https://example.com")']) {
    assert.throws(() => compileHook(path, source), /example.ts/);
  }
  assert.match(compileHook(path, 'throw new Error("not executed"); export default async () => "ok"').javascript, /not executed/);
});
