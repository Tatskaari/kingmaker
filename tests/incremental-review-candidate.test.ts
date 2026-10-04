import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { IncrementalReviewSession, incrementalReviewStrategy } from "../packages/evals/src/incremental-review-candidate.js";
import { oswinKoboldCase } from "../packages/evals/src/oswin-kobold-case.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import type { AiService } from "../packages/conversation/src/services.js";

const context = { characterId: "oswin", participants: ["oswin", "player"], transcript: [create(TranscriptMessageSchema, {
  role: TranscriptRole.CHARACTER, speakerId: "oswin", text: "I will go with you someday." })] };
const yes = { choice: "yes", probabilities: { yes: 1, no: 0, uncertain: 0 } };
const no = { choice: "no", probabilities: { yes: 0, no: 1, uncertain: 0 } };
function fixture(immediate = false) {
  const backing = createScenarioServices(oswinKoboldCase.loadWorld([]));
  let responseCount = 0;
  const ai: AiService = {
    async decisions(_state, questions) { return Object.fromEntries(Object.keys(questions).map(key => [key,
      key === "commitment" || (immediate && (key.startsWith("immediate") || key.startsWith("feasible"))) ? yes : no])); },
    async responses() {
      responseCount++;
      return { role: "assistant", content: JSON.stringify(responseCount % 2 === 0 && immediate
        ? { activity: { name: "Visit parlour", status: "Still in Great Hall", success_criteria: "Reach the parlour", current_goal: "Travel to parlour" } }
        : { candidates: [{ id: "promise", kind: "commitment", undertaking: "A later visit", memory: "I promised a future visit.", evidenceIds: ["m0"] }] }) };
    },
  };
  const runtime = new ConversationRuntime({ services: { ...backing, ai, debug: { record() {} } } });
  return { backing, runtime, calls: () => responseCount };
}

test("future commitment stays staged, commits once, and never invokes action specialist", async () => {
  const { backing, runtime, calls } = fixture();
  const before = backing.scenario.snapshot(), session = new IncrementalReviewSession(runtime.services, "oswin");
  await session.observe(context, new AbortController().signal);
  await session.observe(context, new AbortController().signal);
  assert.deepEqual(backing.scenario.snapshot(), before);
  assert.equal(calls(), 1, "duplicate prefix does not repeat enrichment; no action specialist for future promise");
  const receipt = await session.commit(new AbortController().signal);
  assert.equal(receipt.decisions[0]!.immediate, "no");
  assert.equal(backing.scenario.snapshot().runtimeCharacters.oswin!.activity, undefined);
  assert.match(backing.scenario.snapshot().docs[receipt.documentPath]!.body, /I promised a future visit/);
  await assert.rejects(session.commit(new AbortController().signal), /already committed/);
});

test("immediate feasible candidate invokes specialist but does not publish until end", async () => {
  const { backing, runtime, calls } = fixture(true), session = new IncrementalReviewSession(runtime.services, "oswin");
  await session.observe(context, new AbortController().signal);
  assert.equal(calls(), 2);
  assert.equal(backing.scenario.snapshot().runtimeCharacters.oswin!.activity, undefined);
  await session.commit(new AbortController().signal);
  assert.ok(backing.scenario.snapshot().runtimeCharacters.oswin!.activity);
});

test("concurrent document change rejects stale staged decisions", async () => {
  const { backing, runtime } = fixture(), session = new IncrementalReviewSession(runtime.services, "oswin");
  await session.observe(context, new AbortController().signal);
  const path = backing.scenario.snapshot().runtimeCharacters.oswin!.document, doc = await backing.docs.read(path);
  await backing.docs.insert(path, doc.sha, doc.text.trimEnd().split("\n").length, "\nA concurrent edit.\n");
  await assert.rejects(session.commit(new AbortController().signal), /changed/);
  assert.doesNotMatch((await backing.docs.read(path)).document.body, /I promised a future visit/);
});

test("commit is observable before a blocked full review and receipts enter its request", async () => {
  const { backing, runtime } = fixture();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const strategy = incrementalReviewStrategy();
  await strategy.classify(context, new AbortController().signal, runtime.services);
  let requestSeen!: () => void;
  const seen = new Promise<void>(resolve => { requestSeen = resolve; });
  runtime.services.ai.responses = async request => {
    assert.ok(request.messages.some(message => message.content?.includes('"committedDecisions"')));
    requestSeen(); await blocked;
    return { role: "assistant", content: "", tool_calls: [{ id: "commit", type: "function", function: { name: "commit_review", arguments: JSON.stringify({ summary: "Reviewed", newNotes: [] }) } }] };
  };
  runtime.services.lore.forCharacter = async () => ({ initial: [], links: () => [], open: async () => { throw new Error("unused"); } });
  runtime.services.disclosure.disclose = async () => [];
  const review = strategy.resolve(context, {}, new AbortController().signal, runtime.services);
  await seen;
  const world = backing.scenario.snapshot();
  assert.match(world.docs[world.runtimeCharacters.oswin!.document]!.body, /I promised a future visit/);
  assert.equal(world.runtimeCharacters.oswin!.activity, undefined);
  release(); await review;
});

test("later cancellation supersedes the prepared activity before publication", async () => {
  const { backing, runtime } = fixture(true), session = new IncrementalReviewSession(runtime.services, "oswin");
  await session.observe(context, new AbortController().signal);
  runtime.services.ai.responses = async () => ({ role: "assistant", content: '{"candidates":[]}' });
  await session.observe({ ...context, transcript: [...context.transcript, create(TranscriptMessageSchema, {
    role: TranscriptRole.CHARACTER, speakerId: "oswin", text: "Actually, I will stay here." })] }, new AbortController().signal);
  const receipt = await session.commit(new AbortController().signal);
  assert.equal(receipt.activity, null);
  assert.deepEqual(receipt.decisions, []);
  assert.equal(backing.scenario.snapshot().runtimeCharacters.oswin!.activity, undefined);
});

test("intent revision conflicts are detected even when document text is unchanged", async () => {
  const { backing, runtime } = fixture(true), session = new IncrementalReviewSession(runtime.services, "oswin");
  await session.observe(context, new AbortController().signal);
  const actor = backing.scenario.snapshot().runtimeCharacters.oswin!;
  await backing.docs.commit([], [{ actorId: "oswin", expectedRevision: actor.intentRevision, activity: null, wait: null }]);
  await assert.rejects(session.commit(new AbortController().signal), /changed/);
  assert.equal(backing.scenario.snapshot().runtimeCharacters.oswin!.activity, undefined);
});
