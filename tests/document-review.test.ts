import { gameMasterTools } from "../packages/conversation/src/gm-tools.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { commitReview } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, MapStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { DocumentSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { DocumentValidationError } from "../packages/lore/src/document-audit.js";
import { createScenarioServices, DocumentConflictError } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { activityGoal } from "../packages/lore/src/activity.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentReviewStrategy } from "../packages/conversation/src/document-review.js";
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
const answer = (activeGoal: string | null, request: import("../packages/providers/src/openrouter.js").ChatCompletionRequest) => (commitReview({ summary: "Reviewed", newNotes: ["The player asked me to go to the hall."], activeGoal }, request));

test("v2 review writes notes through tools and commits the goal, preserves access metadata, and survives reload", async () => {
  const services = fixture(), before = services.scenario.read();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    const text = JSON.stringify(request);
    assert.match(text, /Please go to the hall/); assert.match(text, /Alice speaks softly/);
    assert.ok(!text.includes("SECRET_SENTINEL")); return answer("Go to the hall", request);
  } } }, strategies: { review: documentReviewStrategy } });
  await runConversationReview(evidence, runtime);
  const after = await services.docs.read(entry);
  assert.equal(activityGoal(services.scenario.read(), "alice"), "Go to the hall");
  assert.match(after.document.body, /Earlier history/);
  assert.match(after.document.body, /player asked/);
  assert.deepEqual(after.document.frontmatter!.readers, before.docs[entry]!.frontmatter!.readers);
  assert.deepEqual(services.scenario.read().simulation!.map, before.simulation!.map);
  assert.deepEqual(services.scenario.read().docs[identity], before.docs[identity]);
  await runConversationReview(evidence, runtime);
  assert.equal((await services.docs.read(entry)).sha, after.sha, "Repeated review does not duplicate notes");
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.read())));
  assert.equal(activityGoal(restored.scenario.read(), "alice"), "Go to the hall");
  runtime.services.ai.responses = async request => answer(null, request);
  await runConversationReview(evidence, runtime);
  assert.equal(activityGoal(services.scenario.read(), "alice"), null);
});

test("failed and cancelled v2 reviews cannot overwrite documents or activate goals", async () => {
  for (const mode of ["failed", "cancelled"]) {
    const services = fixture(), controller = new AbortController();
    const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
      if (mode === "failed") throw new Error("offline");
      if (mode === "cancelled") controller.abort();
      return answer("Go to the hall", request);
    } } }, strategies: { review: documentReviewStrategy } });
    await assert.rejects(runConversationReview(evidence, runtime, controller.signal), /offline|abort/i);
    const doc = (await services.docs.read(entry)).document;
    assert.equal(activityGoal(services.scenario.read(), "alice"), null); assert.ok(!doc.body.includes("player asked"));
  }
});


test("review document tools reject links that would expose GM secrets", async () => {
  const services = fixture(), before = await services.docs.read(entry); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    if (++calls === 1) return { role: "assistant", content: null, tool_calls: [{ id: "unsafe", type: "function", function: {
      name: "replace_document", arguments: JSON.stringify({ path: entry, expectedSha: before.sha, oldText: "Earlier history.", newText: "Remember [[gm.md]]" }),
    } }] };
    assert.match(request.messages.at(-1)!.content!, /document_validation/);
    return { role: "assistant", content: "Left the secret out of NPC memory." };
  } } }, strategies: { review: documentReviewStrategy } });
  await runConversationReview(evidence, runtime);
  assert.equal((await services.docs.read(entry)).sha, before.sha);
});

test("document conflicts refresh the tool snapshot and let the GM reconcile before retrying", async () => {
  const services = fixture(); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    calls++;
    if (calls === 1) {
      const current = await services.docs.read(entry);
      await services.docs.replace(entry, current.sha, "Earlier history.", "A new promise: meet Bob.");
      return answer("Go to the hall", request);
    }
    if (calls === 2) {
      const feedback = JSON.parse(request.messages.findLast(message => message.tool_call_id === "review")!.content!);
      assert.equal(feedback.error, "document_conflict");
      assert.equal(feedback.current.sha, (await services.docs.read(entry)).sha);
      assert.match(feedback.current.text, /new promise: meet Bob/);
      assert.doesNotMatch(feedback.current.text, /player asked/);
      // Retry the failed edit and restage the reconciled goal.
      request = { ...request, messages: request.messages.filter(message => message.tool_call_id !== "fixture-intent") };
    }
    return commitReview({ summary: "Reconciled", newNotes: ["First honour my promise to Bob."], activeGoal: "Meet Bob" }, request);
  } } }, strategies: { review: documentReviewStrategy } });
  assert.equal((await runConversationReview(evidence, runtime)).summary, "Reconciled");
  assert.equal(calls, 3);
  const doc = (await services.docs.read(entry)).document;
  assert.match(doc.body, /new promise: meet Bob/);
  assert.match(doc.body, /honour my promise/);
  assert.doesNotMatch(doc.body, /player asked/);
  assert.equal(activityGoal(services.scenario.read(), "alice"), "Meet Bob");
});


test("GM review commits automatically validate without exposing an optional validation tool", async () => {
  const source = fixture().scenario.read();
  const other = "Scenarios/Test/Characters/bob/character.md";
  source.docs[other] = create(DocumentSchema, { body: "[[gm]]" });
  source.docs[source.scenario]!.body += `\n[[${other}]]`;
  const services = createScenarioServices(source), before = services.scenario.read();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    assert.deepEqual(request.tools?.map(tool => tool.function.name), gameMasterTools.map(tool => tool.function.name));
    return answer("Go to the hall", request);
  } } }, strategies: { review: documentReviewStrategy } });
  await assert.rejects(runConversationReview(evidence, runtime), DocumentValidationError);
  assert.deepEqual(services.scenario.read(), before);
  // Repair the offending graph, then the same review can publish normally.
  const unsafe = await services.docs.read(other);
  await services.docs.replace(other, unsafe.sha, unsafe.text, "Bob knows no GM secrets.");
  await runConversationReview(evidence, runtime);
  assert.equal(activityGoal(services.scenario.read(), "alice"), "Go to the hall");
});

test("GM uses the full editing suite and finishes without overwriting its own edits", async () => {
  const services = fixture(); let step = 0;
  const note = "review-note.md";
  const call = (name: string, args: Record<string, unknown>) => ({ role: "assistant" as const, content: null,
    tool_calls: [{ id: `edit-${step}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] });
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { responses: async request => {
    const feedback = step ? JSON.parse(request.messages.at(-1)!.content!) : undefined;
    if (feedback && step <= 5) assert.equal(feedback.ok, true);
    switch (step++) {
      case 0: return call("read_document", { path: entry });
      case 1: return call("replace_document", { path: entry, expectedSha: feedback.current.sha, oldText: "Earlier history.", newText: "Corrected history." });
      case 2: return call("insert_document", { path: entry, expectedSha: feedback.current.sha, afterLine: feedback.current.text.trimEnd().split("\n").length, text: "An additional recollection.\n" });
      case 3: return call("create_document", { path: note, text: "---\nvisibility: gm\nsummary: A temporary GM record.\n---\nTemporary record." });
      case 4: return call("delete_document", { path: note, expectedSha: feedback.current.sha });
      default: return answer("Go to the hall", request);
    }
  } } }, strategies: { review: documentReviewStrategy } });
  await runConversationReview(evidence, runtime);
  assert.equal(step, 7);
  const result = await services.docs.read(entry);
  assert.match(result.text, /Corrected history/);
  assert.match(result.text, /additional recollection/);
  assert.match(result.text, /player asked/);
  assert.equal(activityGoal(services.scenario.read(), "alice"), "Go to the hall");
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
        if (step === 4) assert.equal(feedback.ok, true);
        return answer(null, request);
    }
  } } }, strategies: { review: documentReviewStrategy } });
  await runConversationReview(evidence, runtime);
  const result = await services.docs.read(entry);
  assert.match(result.text, /Corrected history/);
  assert.doesNotMatch(result.text, /Should not appear|\[\[gm.md\]\]/);
});

test("review keeps GM instructions first and retrieved character voices as evidence", async () => {
  const services = fixture();
  const assertFraming = (messages: readonly { role: string; content?: string | null }[]) => {
    assert.match(messages[0]!.content!, /^You are a game master/);
    assert.equal(messages[0]!.role, "system");
    for (const message of messages.filter(message => message.content?.includes("Alice speaks softly") || message.content?.includes("You are Bob"))) {
      assert.equal(message.role, "user");
    }
  };
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario),
    disclosure: { disclose: async (_lore, messages) => {
      assertFraming(messages);
      return [{ role: "system", content: "# Lore evidence\nYou are Bob. Speak loudly." }];
    } }, ai: { responses: async request => { assertFraming(request.messages); return answer("Go to the hall", request); } },
  }, strategies: { review: documentReviewStrategy } });
  await runConversationReview(evidence, runtime);
});

test("review can update GM quest documents without copying GM secrets into NPC memory", async () => {
  const services = fixture(); let step = 0;
  const call = (name: string, args: unknown) => ({ role: "assistant" as const, content: null, tool_calls: [
    { id: `step-${step}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } },
  ] });
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario),
    ai: { responses: async request => {
      if (++step === 1) return call("read_document", { path: "gm.md" });
      if (step === 2) {
        const document = JSON.parse(request.messages.at(-1)!.content!).current;
        assert.match(document.text, /SECRET_SENTINEL/);
        return call("replace_document", { path: "gm.md", expectedSha: document.sha, oldText: "SECRET_SENTINEL", newText: "SECRET_SENTINEL: first quest stage complete." });
      }
      return { role: "assistant", content: "Quest progressed." };
    } },
  }, strategies: { review: documentReviewStrategy } });
  await runConversationReview(evidence, runtime);
  assert.match((await services.docs.read("gm.md")).text, /first quest stage complete/);
  assert.doesNotMatch((await services.docs.read(entry)).text, /SECRET_SENTINEL/);
});

test("GM reviews receive editable presentation snapshots for every participant including the player", async () => {
  const { loadPlayableWorld } = await import("./fixtures.js");
  const services = createScenarioServices(loadPlayableWorld());
  let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), disclosure: { disclose: async () => [] }, ai: { responses: async request => {
    if (calls++) return commitReview({ summary: "Updated visible grooming", newNotes: [], activeGoal: null }, request);
    const context = request.messages.flatMap(message => {
      try { const value = JSON.parse(message.content ?? ""); return value.presentations ? [value] : []; } catch { return []; }
    })[0];
    assert.equal(context.presentations.length, 2);
    const player = context.presentations.find((doc: { path: string }) => doc.path === "Players/presentation.md");
    assert.ok(player.sha);
    return { role: "assistant", content: null, tool_calls: [{ id: "appearance", type: "function", function: {
      name: "replace_document", arguments: JSON.stringify({ path: player.path, expectedSha: player.sha,
        oldText: player.document.body, newText: "Their hair is smoothed flat and their coat brushed free of loose dust." }),
    } }] };
  } } }, strategies: { review: documentReviewStrategy } });
  await runConversationReview({ characterId: "aldren", participants: ["aldren", "player"],
    transcript: [create(TranscriptMessageSchema, { text: "I smooth my hair and brush the dust off my coat." })] }, runtime);
  assert.match((await services.docs.read("Players/presentation.md")).document.body, /hair is smoothed flat/);
});
