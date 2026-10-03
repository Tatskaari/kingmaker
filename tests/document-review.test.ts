import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices, DocumentConflictError } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { activeGoal } from "../packages/lore/src/active-goal.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentReviewHooks } from "../packages/conversation/src/document-review.js";
import { runConversationReview } from "../packages/conversation/src/review.js";

const entry = "Scenarios/Test/Characters/alice/character.md", identity = "Cast/Test/alice/private.md";
function fixture() {
  return createScenarioServices(worldState(create(MapSchema), new Map([
    ["Scenarios/Test/index.md", "Index"], ["Scenarios/Test/scenario.md", `[[${entry}]]`],
    [entry, `---\nvisibility: private\nreaders:\n  characters: [alice]\n---\n[[${identity}]]\nEarlier history.`],
    [identity, "---\nvisibility: private\nreaders:\n  characters: [alice]\n---\nAlice speaks softly."],
    ["gm.md", "---\nvisibility: gm\n---\nSECRET_SENTINEL"],
  ]), "Test"));
}
const evidence = { characterId: "alice", participants: ["alice", "player"], transcript: [create(TranscriptMessageSchema, { text: "Please go to the hall." })] };
const answer = (activeGoal: string | null) => ({ role: "assistant" as const,
  content: JSON.stringify({ summary: "Reviewed", newNotes: ["The player asked me to go to the hall."], activeGoal }) });

test("v2 review atomically saves notes and goal, preserves access metadata, and survives reload", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const runtime = new ConversationRuntime({ services: { ...services, ai: { responses: async request => {
    const text = JSON.stringify(request);
    assert.match(text, /Please go to the hall/); assert.match(text, /Alice speaks softly/);
    assert.ok(!text.includes("SECRET_SENTINEL")); return answer("Go to the hall");
  } } }, hooks: { review: documentReviewHooks } });
  await runConversationReview(evidence, runtime);
  const after = await services.docs.read(entry);
  assert.equal(activeGoal(after.document), "Go to the hall");
  assert.match(after.document.body, /Earlier history/);
  assert.match(after.document.body, /player asked/);
  assert.deepEqual(after.document.frontmatter!.readers, before.docs[entry]!.frontmatter!.readers);
  assert.deepEqual(services.scenario.snapshot().map, before.map);
  assert.deepEqual(services.scenario.snapshot().docs[identity], before.docs[identity]);
  await runConversationReview(evidence, runtime);
  assert.equal((await services.docs.read(entry)).sha, after.sha, "Repeated review does not duplicate notes");
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.snapshot())));
  assert.equal(activeGoal((await restored.docs.read(entry)).document), "Go to the hall");
  runtime.services.ai.responses = async () => answer(null);
  await runConversationReview(evidence, runtime);
  assert.equal(activeGoal((await services.docs.read(entry)).document), null);
});

test("failed, cancelled and conflicting v2 reviews cannot overwrite documents or activate goals", async () => {
  for (const mode of ["malformed", "cancelled", "conflict"]) {
    const services = fixture(), controller = new AbortController();
    const runtime = new ConversationRuntime({ services: { ...services, ai: { responses: async () => {
      if (mode === "malformed") return { role: "assistant", content: '{}' };
      if (mode === "cancelled") controller.abort();
      if (mode === "conflict") {
        const current = await services.docs.read(entry);
        await services.docs.replace(entry, current.sha, "Earlier history.", "Newer concurrent history.");
      }
      return answer("Go to the hall");
    } } }, hooks: { review: documentReviewHooks } });
    await assert.rejects(runConversationReview(evidence, runtime, controller.signal), mode === "conflict" ? DocumentConflictError : /Invalid|abort/i);
    const doc = (await services.docs.read(entry)).document;
    assert.equal(activeGoal(doc), null); assert.ok(!doc.body.includes("player asked"));
    if (mode === "conflict") assert.match(doc.body, /Newer concurrent history/);
  }
});


test("v2 review cannot add document links through generated notes", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const runtime = new ConversationRuntime({ services: { ...services, ai: { responses: async () => ({ role: "assistant",
    content: JSON.stringify({ summary: "Reviewed", newNotes: ["Remember [[gm.md]]"], activeGoal: "Read the secret" }) }) } },
    hooks: { review: documentReviewHooks } });
  await assert.rejects(runConversationReview(evidence, runtime), /plain prose/);
  assert.deepEqual(services.scenario.snapshot(), before);
});
