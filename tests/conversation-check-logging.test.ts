import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient, type JevChoice, type JevQuestions } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { logPath } from "../scripts/test-logging.js";
// @ts-expect-error The browser's debug renderer is JavaScript.
import { recentTranscriptsView } from "../apps/web/src/debug-view.js";

function game() {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "classifier-log-secret");
  runtime.createDevelopmentPlayer();
  return runtime;
}
const records = () => readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line))
  .filter(record => record.properties.kind === "conversation_check");

test("conversation classification logs independent decisions without blocking or changing dialogue", async t => {
  const runtime = game();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: '{"utterance":"Welcome.","replyOptions":[],"endConversation":false}' }));
  await runtime.talkToCharacter("corvin", "Good evening.");
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let classifiedMessages: unknown;
  let dialogueMessages: unknown;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    dialogueMessages = structuredClone(request.messages);
    return { role: "assistant", content: '{"utterance":"Welcome.","replyOptions":[],"endConversation":false}' };
  });
  t.mock.method(JevClient.prototype, "evaluate", async (input: any, questions: JevQuestions, signal: AbortSignal) => {
    assert.equal(input.playerTurn, "Please help classifier-log-secret");
    classifiedMessages = structuredClone(input.messages);
    assert.ok(input.messages.some((message: any) => message.role === "system" && message.content.includes("Corvin")));
    assert.ok(input.messages.some((message: any) => message.content.includes("Good evening.")));
    assert.ok(input.messages.some((message: any) => message.content.includes("Welcome.")));
    assert.equal(signal.aborted, false);
    await waiting;
    return Object.fromEntries(Object.keys(questions).map(skill => [skill, {
      choice: skill === "persuasion" ? "needed" : "not_needed",
      probabilities: { needed: skill === "persuasion" ? 0.9 : 0.1, not_needed: skill === "persuasion" ? 0.1 : 0.9 }, confidence: 0.8,
    } satisfies JevChoice]));
  });
  const before = runtime.snapshot();
  const pending = runtime.forkForNpc().logConversationChecks("corvin", "Please help classifier-log-secret");
  assert.equal(runtime.recentTranscripts()[0]!.status, "pending");
  assert.equal(await runtime.talkToCharacter("corvin", "Please help classifier-log-secret"), "Welcome.");
  assert.deepEqual(classifiedMessages, dialogueMessages, "Jev receives the exact initial dialogue messages, including all system prompts");
  const afterDialogue = runtime.snapshot();
  finish(); await pending;
  assert.deepEqual(runtime.snapshot(), afterDialogue);
  assert.notDeepEqual(afterDialogue.conversations, before.conversations);
  const entry = runtime.recentTranscripts().find(item => item.kind === "conversation_check")!;
  assert.equal(entry.status, "success");
  assert.deepEqual((entry.response as any).checks, ["persuasion"]);
  assert.equal(Object.keys((entry.response as any).decisions).length, 18);
  const logs = records();
  assert.equal(logs.length, 2);
  assert.equal(logs[0].properties.runKey, logs[1].properties.runKey);
  assert.equal(logs[0].properties.callId, logs[1].properties.callId);
  assert.doesNotMatch(JSON.stringify(logs), /classifier-log-secret/);
  const html = recentTranscriptsView([entry], {}, { session: `request:${entry.id}`, call: String(entry.id) });
  assert.match(html, /Jev conversation checks/);
  assert.match(html, /persuasion/);
  assert.match(html, /90%/);
});

test("classification failures are logged as errors, not no-check results", async t => {
  const runtime = game(), before = runtime.snapshot();
  t.mock.method(JevClient.prototype, "evaluate", async () => { throw new Error("classifier-log-secret unavailable"); });
  await runtime.logConversationChecks("corvin", "Help me.");
  assert.deepEqual(runtime.snapshot(), before);
  const entry = runtime.recentTranscripts()[0]!;
  assert.equal(entry.status, "error");
  assert.equal(entry.error, "[redacted] unavailable");
  assert.equal(entry.response, undefined);
  assert.equal(records().at(-1).message, "JEV: conversation classification failed");
  const count = runtime.recentTranscripts().length;
  await runtime.logConversationChecks("missing", "Hello");
  await runtime.logConversationChecks("corvin", " ");
  assert.equal(runtime.recentTranscripts().length, count);
});
