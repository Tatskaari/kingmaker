import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { CHARACTER_PROMPT, conversationRequest, converse as runTurn, type ConversationInput, type LlmTurn } from "../packages/conversation/src/conversation.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import type { Complete } from "../packages/conversation/src/conversation.js";
import { loadCharacterLore } from "../packages/conversation/src/lore.js";

const converse = (input: ConversationInput, complete: Complete, signal?: AbortSignal, trace?: (turn: LlmTurn) => void) =>
  runTurn(input, new ConversationRuntime({ services: { character: { respond: complete } }, hooks: { conversation: {
    classify: async () => ({}), resolve: async () => ({ reclassify: false }),
  } } }), signal, trace);

const input = (): ConversationInput => ({
  snapshot: { scenario: JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")) },
  characterId: "corvin", sources: [{ path: "private.md", markdown: "A precise legal scholar." }, { path: "knowledge.md", markdown: "You believe the king avoids difficult decisions." }, { path: "character.md", markdown: "Ask the visitor about the seal." }],
  transcript: [], message: "Who are you?",
});

test("dialogue uses Markdown identity, knowledge and scenario without snapshot context", () => {
  const requestInput = input();
  const request = conversationRequest(requestInput);
  assert.equal(request.messages[0]?.content, CHARACTER_PROMPT);
  assert.doesNotMatch(CHARACTER_PROMPT, /Corvin|Caerwyn|Centennial/);
  assert.match(request.messages[1]!.content!, /A precise legal scholar/);
  assert.deepEqual(request.messages.slice(1, 4).map(message => message.content),
    requestInput.sources.map(document => `# Lore: ${document.path}\n${document.markdown}`));
  assert.doesNotMatch(request.messages.map(message => message.content).join("\n"), /currentGoal|dialogueObjectives|Current character state/);
  assert.equal(request.messages.at(-1)?.content, "Who are you?");
  assert.equal(request.tools, undefined);
});

test("a turn returns a reviewable transcript without changing the snapshot or prior history", async () => {
  const request = input();
  request.transcript = [create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: "corvin", text: "Welcome." })];
  const before = structuredClone(request), traces: LlmTurn[] = [];
  const result = await converse(request, async modelRequest => {
    assert.equal(modelRequest.messages.at(-2)?.content, "Welcome.");
    return { role: "assistant", content: "I am the keeper of the seal." };
  }, undefined, turn => traces.push(turn));
  assert.deepEqual(request, before);
  assert.equal(result.characterId, "corvin");
  assert.deepEqual(result.transcript.map(message => message.role), [TranscriptRole.CHARACTER, TranscriptRole.PLAYER, TranscriptRole.CHARACTER]);
  assert.equal(traces.length, 3);
  assert.equal(traces[2]?.response?.content, result.transcript.at(-1)?.text);
});

test("failed and cancelled calls leave history untouched and expose debug errors", async () => {
  const request = input(), traces: LlmTurn[] = [];
  await assert.rejects(converse(request, async () => { throw new Error("Provider unavailable"); }, undefined, turn => traces.push(turn)), /Provider unavailable/);
  assert.equal(traces.at(-1)?.error, "Provider unavailable");
  assert.deepEqual(request.transcript, []);
  const controller = new AbortController();
  await assert.rejects(converse(request, async () => {
    controller.abort();
    return { role: "assistant", content: "Late result" };
  }, controller.signal), /abort/i);
  await assert.rejects(converse(request, async () => ({ role: "assistant", content: null })), /plain character reply/);
});

test("lore starts with private identity and scenario entry; knowledge stays unopened", () => {
  const lore = loadCharacterLore(new URL("../lore", import.meta.url).pathname, "Centennial Assembly", "corvin");
  assert.equal(lore.initial.length, 2);
  assert.match(lore.initial[0]!.markdown, /# Magister Corvin/);
  assert.match(lore.initial[0]!.markdown, /## Speech style/);
  assert.ok(lore.initial[1]!.path.endsWith("/corvin/character.md"));
  const candidates = lore.candidates(lore.initial);
  assert.equal(candidates.filter(link => link.path.includes("/knowledge/")).length, 13);
  assert.equal(candidates.filter(link => link.path.includes("/corvin/")).length, 3);
  const knowledge = lore.read(candidates.find(link => link.path.endsWith("Lady Elinor Ash.md"))!.path);
  assert.equal(knowledge.markdown.trim(), "This is a stub.");
  assert.throws(() => lore.read("Cast/Caerwyn/Magister Corvin/gm.md"), /No read access/);
  assert.throws(() => conversationRequest({ ...input(), characterId: "missing" }), /Unknown snapshot character/);
});
