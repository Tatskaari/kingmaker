import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryReviewServices } from "../packages/evals/src/inventory-docs-candidate.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { peregrineGiftCase, giftInventoryScore } from "../packages/evals/src/peregrine-gift-case.js";

const gift = 'items:\n    - id: gift-bird\n      name: Carved wooden bird\n      details: Faded blue lacquer wings.\n      quantity: 1';
test("candidate document edits persist typed inventory while baseline remains unchanged", async () => {
  const initial = peregrineGiftCase.loadWorld([]), candidate = createInventoryReviewServices(initial);
  const baseline = createScenarioServices(initial), path = initial.player!;
  const before = await candidate.docs.read(path);
  const after = await candidate.docs.replace(path, before.sha, "inventory: {}", `inventory:\n  ${gift}`);
  assert.equal(giftInventoryScore(candidate.scenario.snapshot()).score, 1);
  assert.equal(giftInventoryScore(baseline.scenario.snapshot()).score, 0);
  assert.deepEqual(after.document.characterProperties?.dnd, before.document.characterProperties?.dnd);
  assert.equal(after.document.body, before.document.body);
  assert.equal(after.document.frontmatter?.inventory, undefined, "virtual YAML does not leave a second inventory");
  await assert.rejects(candidate.docs.replace(path, before.sha, "quantity: 1", "quantity: 2"), /changed/);
  await candidate.docs.commit([{ path, expectedSha: after.sha, text: after.text.replace(/inventory:[\s\S]*?---/, '---') }]);
  assert.equal(giftInventoryScore(candidate.scenario.snapshot()).score, 1, "ordinary review commit preserves typed inventory");
});

test("invalid inventory changes publish neither prose nor possessions", async () => {
  const candidate = createInventoryReviewServices(peregrineGiftCase.loadWorld([]));
  const path = candidate.scenario.info().player!, before = await candidate.docs.read(path);
  const duplicate = gift.replace("gift-bird", "peregrine_rapier");
  await assert.rejects(candidate.docs.replace(path, before.sha, "inventory: {}", `inventory:\n  ${duplicate}`), /Duplicate/);
  assert.deepEqual(await candidate.docs.read(path), before);
  await assert.rejects(candidate.docs.replace(path, before.sha, "inventory: {}", 'inventory:\n  items: []\n  equipment:\n    mainHandItemId: missing'), /not carried/);
  assert.deepEqual(await candidate.docs.read(path), before);
});
