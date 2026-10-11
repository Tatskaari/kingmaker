import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import { permitted } from "../packages/lore/src/access.js";
import { reviewGuidance } from "../packages/conversation/src/review-prompt-context.js";

test("generated reference is discoverable, linked, GM-only and protected after resume", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const index = await services.docs.read("docs/hooks/index.md");
  assert.match(reviewGuidance, /docs\/hooks\/index.md/);
  assert.ok(index.document.links.length > 0);
  for (const link of index.document.links) await services.docs.read(link.target);
  const page = await services.docs.read("docs/hooks/interfaces/HookQuestService.md");
  assert.match(page.text, /setActive/);
  assert.equal(permitted(page.path, { body: page.document.body, metadata: page.document.frontmatter! }, "", { character: "aldren" }), false);
  const resumed = createScenarioServices(services.currentWorld());
  assert.equal((await resumed.docs.read(index.path)).text, index.text);
  await assert.rejects(resumed.docs.delete(index.path, index.sha), /read-only/);
  assert.ok((await resumed.docs.query("SELECT path FROM docs WHERE folder = 'docs/hooks/interfaces'")).rows.length > 0);
});
