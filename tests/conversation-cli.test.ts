import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { CHARACTER_PROMPT, conversationRequest, converse, type ConversationInput, type LlmTurn } from "../packages/conversation/src/conversation.js";
import { loadCharacterSources } from "../packages/conversation/src/lore.js";

const input = (): ConversationInput => ({
  snapshot: { scenario: JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")) },
  characterId: "corvin", sources: { cast: "A precise legal scholar.", knowledge: "You believe the king avoids difficult decisions.", scenario: "Ask the visitor about the seal." },
  transcript: [], message: "Who are you?",
});

test("dialogue uses Markdown identity, knowledge and scenario without snapshot context", () => {
  const requestInput = input();
  const request = conversationRequest(requestInput);
  assert.equal(request.messages[0]?.content, CHARACTER_PROMPT);
  assert.doesNotMatch(CHARACTER_PROMPT, /Corvin|Caerwyn|Centennial/);
  assert.match(request.messages[1]!.content!, /A precise legal scholar/);
  assert.deepEqual(request.messages.slice(1, 4).map(message => message.content), [
    `# Character identity and voice\n${requestInput.sources.cast}`,
    `# Character knowledge and beliefs\n${requestInput.sources.knowledge}`,
    `# Character scenario briefing\n${requestInput.sources.scenario}`,
  ]);
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
  assert.equal(traces.length, 2);
  assert.equal(traces[1]?.response?.content, result.transcript.at(-1)?.text);
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

test("lore loads private Cast identity, observer knowledge and scenario files without author indexes or GM notes", () => {
  const sources = loadCharacterSources(new URL("../lore", import.meta.url).pathname, "Centennial Assembly", "corvin");
  assert.match(sources.cast, /# Magister Corvin/);
  assert.match(sources.cast, /## Speech style/);
  assert.match(sources.knowledge, /Magister Corvin\/knowledge\/Lady Elinor Ash.md/);
  assert.equal((sources.knowledge.match(/characters: \[corvin\]/g) ?? []).length, 12);
  assert.doesNotMatch([sources.cast, sources.knowledge, sources.scenario].join("\n"), /visibility: gm|GM notes|Source: #|Author navigation/);
  for (const name of ["character", "background", "situation", "conversation"]) assert.ok(sources.scenario.includes(`/corvin/${name}.md`));
  assert.doesNotMatch(sources.scenario, /# Centennial Assembly — GM entry/);
  assert.throws(() => conversationRequest({ ...input(), characterId: "missing" }), /Unknown snapshot character/);
});
