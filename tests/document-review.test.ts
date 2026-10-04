import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { commitReview } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { DocumentSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { DocumentValidationError } from "../packages/lore/src/document-audit.js";
import { createScenarioServices, DocumentConflictError } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { activityGoal } from "../packages/lore/src/activity.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentReviewHooks } from "../packages/conversation/src/document-review.js";
import { runConversationReview } from "../packages/conversation/src/review.js";

const entry = "Scenarios/Test/Characters/alice/character.md", identity = "Cast/Test/alice/private.md";
function fixture() {
  return createScenarioServices(worldState(create(MapSchema), new Map([
    ["Scenarios/Test/index.md", "Index"], ["Scenarios/Test/scenario.md", `[[${entry}]]`],
    [entry, `---\nvisibility: private\nreaders: ['character:alice']\n---\n[[${identity}]]\nEarlier history.`],
    [identity, "---\nvisibility: private\nreaders: ['character:alice']\n---\nAlice speaks softly."],
    ["gm.md", "---\nvisibility: gm\n---\nSECRET_SENTINEL"],
  ]), "Test"));
}
const evidence = { characterId: "alice", participants: ["alice", "player"], transcript: [create(TranscriptMessageSchema, { text: "Please go to the hall." })] };
const answer = (activeGoal: string | null) => (commitReview({ summary: "Reviewed", newNotes: ["The player asked me to go to the hall."], activeGoal }));

test("v2 review atomically saves notes and goal, preserves access metadata, and survives reload", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    const text = JSON.stringify(request);
    assert.match(text, /Please go to the hall/); assert.match(text, /Alice speaks softly/);
    assert.ok(!text.includes("SECRET_SENTINEL")); return answer("Go to the hall");
  } } }, hooks: { review: documentReviewHooks } });
  await runConversationReview(evidence, runtime);
  const after = await services.docs.read(entry);
  assert.equal(activityGoal(services.scenario.snapshot(), "alice"), "Go to the hall");
  assert.match(after.document.body, /Earlier history/);
  assert.match(after.document.body, /player asked/);
  assert.deepEqual(after.document.frontmatter!.readers, before.docs[entry]!.frontmatter!.readers);
  assert.deepEqual(services.scenario.snapshot().map, before.map);
  assert.deepEqual(services.scenario.snapshot().docs[identity], before.docs[identity]);
  await runConversationReview(evidence, runtime);
  assert.equal((await services.docs.read(entry)).sha, after.sha, "Repeated review does not duplicate notes");
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.snapshot())));
  assert.equal(activityGoal(restored.scenario.snapshot(), "alice"), "Go to the hall");
  runtime.services.ai.responses = async () => answer(null);
  await runConversationReview(evidence, runtime);
  assert.equal(activityGoal(services.scenario.snapshot(), "alice"), null);
});

test("failed and cancelled v2 reviews cannot overwrite documents or activate goals", async () => {
  for (const mode of ["malformed", "cancelled"]) {
    const services = fixture(), controller = new AbortController();
    const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async () => {
      if (mode === "malformed") return { role: "assistant", content: '{}' };
      if (mode === "cancelled") controller.abort();
      return answer("Go to the hall");
    } } }, hooks: { review: documentReviewHooks } });
    await assert.rejects(runConversationReview(evidence, runtime, controller.signal), /Invalid|abort|must call/i);
    const doc = (await services.docs.read(entry)).document;
    assert.equal(activityGoal(services.scenario.snapshot(), "alice"), null); assert.ok(!doc.body.includes("player asked"));
  }
});


test("v2 review cannot add document links through generated notes", async () => {
  const services = fixture(), before = services.scenario.snapshot();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async () => (commitReview({ summary: "Reviewed", newNotes: ["Remember [[gm.md]]"], activeGoal: "Read the secret" })) } },
    hooks: { review: documentReviewHooks } });
  await assert.rejects(runConversationReview(evidence, runtime), /plain prose/);
  assert.deepEqual(services.scenario.snapshot(), before);
});

test("document conflicts refresh the tool snapshot and let the GM reconcile before retrying", async () => {
  const services = fixture(); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    calls++;
    if (calls === 1) {
      const current = await services.docs.read(entry);
      await services.docs.replace(entry, current.sha, "Earlier history.", "A new promise: meet Bob.");
      return answer("Go to the hall");
    }
    const feedback = JSON.parse(request.messages.at(-1)!.content!);
    assert.equal(request.messages.at(-1)!.role, "tool");
    assert.equal(feedback.error, "document_conflict");
    assert.equal(feedback.current.sha, (await services.docs.read(entry)).sha);
    assert.match(feedback.current.text, /new promise: meet Bob/);
    assert.doesNotMatch(feedback.current.text, /player asked/);
    return commitReview({ summary: "Reconciled", newNotes: ["First honour my promise to Bob."], activeGoal: "Meet Bob" });
  } } }, hooks: { review: documentReviewHooks } });
  assert.equal((await runConversationReview(evidence, runtime)).summary, "Reconciled");
  assert.equal(calls, 2);
  const doc = (await services.docs.read(entry)).document;
  assert.match(doc.body, /new promise: meet Bob/);
  assert.match(doc.body, /honour my promise/);
  assert.doesNotMatch(doc.body, /player asked/);
  assert.equal(activityGoal(services.scenario.snapshot(), "alice"), "Meet Bob");
});


test("GM review commits automatically validate without exposing an optional validation tool", async () => {
  const source = fixture().scenario.snapshot();
  const other = "Scenarios/Test/Characters/bob/character.md";
  source.docs[other] = create(DocumentSchema, { body: "[[gm]]" });
  source.docs[source.scenario]!.body += `\n[[${other}]]`;
  const services = createScenarioServices(source), before = services.scenario.snapshot();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    assert.deepEqual(request.tools?.map(tool => tool.function.name), ["read_document", "create_document", "replace_document", "insert_document", "delete_document", "set_activity", "set_wait", "clear_activity", "commit_review"]);
    return answer("Go to the hall");
  } } }, hooks: { review: documentReviewHooks } });
  await assert.rejects(runConversationReview(evidence, runtime), DocumentValidationError);
  assert.deepEqual(services.scenario.snapshot(), before);
  // Repair the offending graph, then the same review can publish normally.
  const unsafe = await services.docs.read(other);
  await services.docs.replace(other, unsafe.sha, unsafe.text, "Bob knows no GM secrets.");
  await runConversationReview(evidence, runtime);
  assert.equal(activityGoal(services.scenario.snapshot(), "alice"), "Go to the hall");
});

test("GM uses the full editing suite and finishes without overwriting its own edits", async () => {
  const services = fixture(); let step = 0;
  const note = "review-note.md";
  const call = (name: string, args: Record<string, unknown>) => ({ role: "assistant" as const, content: null,
    tool_calls: [{ id: `edit-${step}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] });
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    const feedback = step ? JSON.parse(request.messages.at(-1)!.content!) : undefined;
    if (feedback) assert.equal(feedback.ok, true);
    switch (step++) {
      case 0: return call("read_document", { path: entry });
      case 1: return call("replace_document", { path: entry, expectedSha: feedback.current.sha, oldText: "Earlier history.", newText: "Corrected history." });
      case 2: return call("insert_document", { path: entry, expectedSha: feedback.current.sha, afterLine: feedback.current.text.trimEnd().split("\n").length, text: "An additional recollection.\n" });
      case 3: return call("create_document", { path: note, text: "---\nvisibility: gm\nsummary: A temporary GM record.\n---\nTemporary record." });
      case 4: return call("delete_document", { path: note, expectedSha: feedback.current.sha });
      default: return answer("Go to the hall");
    }
  } } }, hooks: { review: documentReviewHooks } });
  await runConversationReview(evidence, runtime);
  assert.equal(step, 6);
  const result = await services.docs.read(entry);
  assert.match(result.text, /Corrected history/);
  assert.match(result.text, /additional recollection/);
  assert.match(result.text, /player asked/);
  assert.equal(activityGoal(services.scenario.snapshot(), "alice"), "Go to the hall");
  await assert.rejects(services.docs.read(note), /not found/);
});

test("GM receives edit conflicts and validation failures and can repair its proposal", async () => {
  const services = fixture(); let step = 0;
  const initial = await services.docs.read(entry);
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    const feedback = step ? JSON.parse(request.messages.at(-1)!.content!) : undefined;
    const edit = (sha: string, newText: string) => ({ role: "assistant" as const, content: null,
      tool_calls: [{ id: `edit-${step}`, type: "function" as const, function: { name: "replace_document", arguments: JSON.stringify({ path: entry, expectedSha: sha, oldText: "Earlier history.", newText }) } }] });
    switch (step++) {
      case 0: return edit("stale", "Should not appear.");
      case 1:
        assert.equal(feedback.error, "document_conflict");
        assert.equal(feedback.current.sha, initial.sha);
        return edit(feedback.current.sha, "[[gm.md]]");
      case 2:
        assert.equal(feedback.error, "document_validation");
        assert.equal((await services.docs.read(entry)).sha, initial.sha);
        return edit(initial.sha, "Corrected history.");
      default:
        assert.equal(feedback.ok, true);
        return answer(null);
    }
  } } }, hooks: { review: documentReviewHooks } });
  await runConversationReview(evidence, runtime);
  const result = await services.docs.read(entry);
  assert.match(result.text, /Corrected history/);
  assert.doesNotMatch(result.text, /Should not appear|\[\[gm.md\]\]/);
});
