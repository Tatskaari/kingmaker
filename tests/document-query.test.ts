import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

const target = "Quests/query-target.md", source = "Quests/query-source.md";
async function fixture() {
  const { docs } = createScenarioServices(loadPlayableWorld());
  await docs.create(target, "---\nsummary: Target\nvisibility: gm\nreaders: [\"label:alpha\", \"label:beta\"]\nParent: quests\n---\nThe Envoy brings a tribute.\nNothing else.");
  await docs.create(source, "---\nsummary: Source\nvisibility: gm\nstatus: draft\n---\nSee [target](query-target.md).");
  return docs;
}

test("document queries follow links, match list items and regexes over live documents", async () => {
  const docs = await fixture();
  const result = await docs.query(`SELECT file.path, file.name, file.folder, parent, snippets(file.body, 'envoy') AS hits FROM docs
    WHERE file.backlinks IN (SELECT file.path FROM docs WHERE status = 'draft' AND file.links ~ 'query-target')
      AND readers ~* '^LABEL:beta$' AND file.body ~* 'TRIBUTE' AND NOT readers = 'label:gamma'`);
  assert.deepEqual(result, { columns: ["file.path", "file.name", "file.folder", "parent", "hits"], truncated: false, rows: [{
    "file.path": target, "file.name": "query-target", "file.folder": "Quests", parent: "quests",
    hits: [{ line: 1, text: "The Envoy brings a tribute." }],
  }] });
  const updated = await docs.read(source);
  await docs.replace(source, updated.sha, "See [target](query-target.md).", "No links.");
  assert.deepEqual((await docs.query(`SELECT file.path FROM docs WHERE file.backlinks IN ('${source}')`)).rows, []);
});

test("document queries order, page, project properties and treat missing values as absent", async () => {
  const docs = await fixture();
  const ordered = await docs.query(`SELECT file.path, status FROM docs WHERE file.folder = 'Quests' AND file.name LIKE 'query-%'
    ORDER BY status DESC, file.path LIMIT 1 OFFSET 1`);
  assert.deepEqual(ordered.rows, [{ "file.path": target, status: null }]);
  const missing = await docs.query("SELECT file.path FROM docs WHERE file.name ILIKE 'QUERY-%' AND status IS NULL AND status NOT IN ('done')");
  assert.deepEqual(missing.rows, [{ "file.path": target }]);
  const all = await docs.query(`SELECT * FROM docs WHERE file.path = '${source}'`);
  assert.deepEqual(all.rows, [{ "file.path": source, summary: "Source", visibility: "gm", status: "draft" }]);
});

test("document queries are single read-only selects with readable errors", async () => {
  const docs = await fixture();
  await assert.rejects(docs.query("DELETE FROM docs"), /delete statements; queries are read-only/);
  await assert.rejects(docs.query("SELECT 1; SELECT 2"), /one SQL statement at a time/);
  await assert.rejects(docs.query("SELECT file.path FROM docs d JOIN docs e ON true"), /without joins/);
  await assert.rejects(docs.query("SELECT count(*) FROM docs"), /only snippets/);
  await assert.rejects(docs.query("SELECT file.path FROM docs WHERE file.body ~ '('"), /Invalid regular expression/);
  await assert.rejects(docs.query("SELECT file.path FROM docs WHERE stauts = 'draft'"), /Unknown property: stauts/);
  await assert.rejects(docs.query("SELECT file.size FROM docs"), /Unknown file field/);
  await assert.rejects(docs.query("SELEC"), /Invalid SQL/);
  assert.equal((await docs.query("SELECT file.path FROM docs")).truncated, true);
});
