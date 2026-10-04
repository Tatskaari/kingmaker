import assert from "node:assert/strict";
import test from "node:test";
import { applyNewItems } from "../packages/evals/src/effect-ledger-variant.js";
import { createInventoryReviewServices } from "../packages/evals/src/inventory-docs-candidate.js";
import { peregrineGiftCase, giftInventoryScore } from "../packages/evals/src/peregrine-gift-case.js";
import { Recording } from "../packages/service-tools/src/recording.js";

const item = { recipientId: "player", name: "Carved wooden bird", details: "Faded blue wings; origin attributed to the giver." };
test("effect ledger maps recipient to a real recorded inventory write", async () => {
  const backing = createInventoryReviewServices(peregrineGiftCase.loadWorld([]));
  const recording = new Recording();
  const services = { ...backing, docs: recording.wrap("docs", backing.docs) };
  const before = backing.scenario.snapshot();
  const applied = await applyNewItems([item], services, new AbortController().signal);
  const after = backing.scenario.snapshot();
  assert.equal(applied[0]!.path, after.player);
  assert.equal(giftInventoryScore(after).score, 1);
  assert.deepEqual(after.docs[after.runtimeCharacters.peregrine!.document], before.docs[before.runtimeCharacters.peregrine!.document]);
  assert.ok(recording.getCalls().some(call => call.service === "docs" && call.method === "replace"));
  await assert.rejects(applyNewItems([item], services, new AbortController().signal), /already exists/);
  assert.equal(giftInventoryScore(backing.scenario.snapshot()).score, 1);
});

test("effect ledger rejects unknown recipients before any item is written", async () => {
  const backing = createInventoryReviewServices(peregrineGiftCase.loadWorld([]));
  await assert.rejects(applyNewItems([item, { ...item, recipientId: "nonexistent" }], backing, new AbortController().signal), /Unknown recipient/);
  assert.equal(giftInventoryScore(backing.scenario.snapshot()).score, 0);
});
