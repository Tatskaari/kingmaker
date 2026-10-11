import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

const target = "Quests/query-target.md", source = "Quests/query-source.md";
async function fixture() {
  const { docs } = createScenarioServices(loadPlayableWorld());
  await docs.create(target, "---\nsummary: Target\nvisibility: gm\nreaders: [\"label:alpha\", \"label:beta\"]\n---\nThe Envoy brings a tribute.\nNothing else.");
  await docs.create(source, "---\nsummary: Source\nvisibility: gm\nstatus: draft\n---\nSee [target](query-target.md).");
  return docs;
}

test("document queries join properties, links and regex matches over live documents", async () => {
  const docs = await fixture();
  const result = await docs.query(`SELECT d.path, d.name, d.folder, snippets(d.body, 'envoy') AS hits FROM docs d
    JOIN links l ON l.target = d.path JOIN props p ON p.path = l.source AND p.key = 'status' AND p.value = 'draft'
    WHERE EXISTS (SELECT 1 FROM props r WHERE r.path = d.path AND r.key = 'readers' AND r.value REGEXP '^label:beta$')
      AND d.body REGEXP 'TRIBUTE'`);
  assert.deepEqual(result, { columns: ["path", "name", "folder", "hits"], truncated: false, rows: [{
    path: target, name: "query-target", folder: "Quests", hits: JSON.stringify([{ line: 1, text: "The Envoy brings a tribute." }]),
  }] });
  const updated = await docs.read(source);
  await docs.replace(source, updated.sha, "See [target](query-target.md).", "No links.");
  assert.equal((await docs.query(`SELECT count(*) AS n FROM links WHERE source = '${source}'`)).rows[0]!.n, 0);
});

test("document queries are single read-only statements with readable errors", async () => {
  const docs = await fixture();
  await assert.rejects(docs.query("DELETE FROM docs"), /readonly/);
  await assert.rejects(docs.query("SELECT 1; DELETE FROM docs"), /one SQL statement at a time/);
  await assert.rejects(docs.query("SELECT body REGEXP '(' FROM docs"), /Invalid regular expression/);
  assert.equal((await docs.query("SELECT count(*) AS n FROM docs WHERE path = 'Quests/query-target.md'")).rows[0]!.n, 1);
  assert.equal((await docs.query("SELECT path FROM docs")).truncated, true);
});
