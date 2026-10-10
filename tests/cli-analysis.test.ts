import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runConversation } from "../packages/conversation/src/phases.js";
import { CheckDegree } from "../packages/core/src/ability-checks.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { formatAnalysis, formatConversation, type MessageAnalysis } from "../apps/conversation-cli/analysis.js";
import { conversationStrategy } from "../packages/conversation/src/conversation-strategy.js";
import { DisclosureSession } from "../packages/conversation/src/disclosure.js";
import type { AiService } from "../packages/conversation/src/services.js";

const label = { choice: "not_flagged", probabilities: { flagged: 0.1, not_flagged: 0.9 }, confidence: 0.8 };
test("inline analysis stays under its message and shows only flagged labels with probabilities and rolls", () => {
  const transcript = [create(TranscriptMessageSchema, { speakerId: "player", text: "Help me." }),
    create(TranscriptMessageSchema, { speakerId: "corvin", text: "I will help." })];
  const analysis: MessageAnalysis[] = [
    { messageIndex: 0, subject: "player", kind: "labels", source: "skill_check", decisions: { persuasion: { ...label, choice: "needed" }, deception: { ...label, choice: "not_needed" } } },
    { messageIndex: 0, subject: "player", kind: "roll", result: { characterId: "player", skill: "persuasion", difficulty: "normal", natural: 15, modifier: 2, total: 17, dc: 15, success: true, outcome: CheckDegree.MinorSuccess } },
    { messageIndex: 1, subject: "character", kind: "labels", source: "attention", decisions: { immediate_commitment: label, general_commitment: { ...label, choice: "flagged" }, immediate_feasibility: { ...label, choice: "possible" } } },
  ];
  const output = formatConversation(transcript, "corvin", analysis);
  assert.match(output, /You: Help me\.\n  skill_check · persuasion: needed/);
  assert.match(output, /d20 15 \+ 2 = 17; normal, DC 15; success/);
  assert.match(output, /corvin: I will help\.\n  attention · general_commitment: flagged/);
  assert.match(output, /flagged 10.0%, not_flagged 90.0%/);
  assert.match(output, /confidence 80.0%/);
  assert.doesNotMatch(output, /· deception:|· immediate_commitment:|· immediate_feasibility:/);
  assert.equal(formatConversation(transcript, "corvin", []), "You: Help me.\n\ncorvin: I will help.");
});

test("CLI reports failed attention analysis without losing reply and propagates cancellation", async () => {
  const ai: AiService = { decisions: async (_state, questions, _signal, purpose) => {
    if (purpose === "conversation_attention") throw Error("Provider unavailable");
    return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "not_needed", probabilities: { not_needed: 1 } }]));
  }, responses: async () => ({ role: "assistant", content: "Reply" }) };
  const disclosure = new DisclosureSession({ initial: [], links: () => [], open: async () => { throw Error("Unexpected open"); } }, ai);
  const events: unknown[] = [];
  const strategy = conversationStrategy(disclosure, ai, undefined, "Hello", async () => 10, () => {}, () => {}, {}, {}, undefined, event => events.push(event));
  const request = { model: "test", messages: [] };
  const runtime = new ConversationRuntime({ strategies: { conversation: strategy }, services: { character: { respond: ai.responses } } });
  const reply = { role: "assistant" as const, content: "Reply" };
  assert.deepEqual(await runConversation(request, runtime), reply);
  assert.deepEqual(events.slice(-1), [{ kind: "error", subject: "character", error: "Error: Provider unavailable" }]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runConversation(request, runtime, controller.signal), /abort/i);
  assert.equal(events.length, 2);
});


test("CLI shows GM discretion alongside an immediate commitment or agreed exchange", () => {
  const text = formatAnalysis({ kind: "labels", subject: "character", source: "attention", decisions: {
    immediate_commitment: { choice: "flagged", probabilities: { flagged: 1, not_flagged: 0 } },
    immediate_feasibility: { choice: "gms_discretion", probabilities: { gms_discretion: 0.9, impossible: 0.1 } },
  } });
  assert.match(text, /immediate_feasibility: gms_discretion/);
});


test("an agreed exchange retains GM discretion even when the commitment classifier disagrees", () => {
  assert.match(formatAnalysis({ kind: "labels", subject: "character", source: "attention", decisions: {
    immediate_commitment: { choice: "not_flagged", probabilities: {} },
    conversational_exchange: { choice: "flagged", probabilities: {} },
    immediate_feasibility: { choice: "gms_discretion", probabilities: { gms_discretion: 1 } },
  } }), /immediate_feasibility: gms_discretion/);
});

test("CLI labels injected goals as system messages", () => {
  assert.equal(formatConversation([create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, text: "Ask for help." })], "aldren", []), "System: Ask for help.");
});
