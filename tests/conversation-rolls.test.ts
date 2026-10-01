import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient, type JevQuestions } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { adjudicateConversationChecks } from "../apps/web/src/conversation-rolls.js";

const game = () => {
  const runtime = new BrowserGameRuntime(fromJsonString(ScenarioSchema, readFileSync("content/scenarios/last-night.json", "utf8")), "test");
  runtime.createDevelopmentPlayer(); return runtime;
};
const reply = (content: unknown) => ({ role: "assistant" as const, content: JSON.stringify(content) });

test("GM plans before dice, waits for presentation, then directs the character with a persisted system ruling", async t => {
  const runtime = game(), order: string[] = [];
  t.mock.method(JevClient.prototype, "evaluate", async (_input: unknown, questions: JevQuestions) =>
    Object.fromEntries(Object.keys(questions).map(skill => [skill, { choice: skill === "persuasion" ? "needed" : "not_needed", probabilities: { needed: 1, not_needed: 0 } }])));
  t.mock.method(globalThis.crypto, "getRandomValues", (buffer: any) => { buffer[0] = 0; return buffer; });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let shown!: () => void;
  const presentation = new Promise<void>(resolve => { shown = resolve; });
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    const schema = request.response_format?.json_schema?.name;
    if (schema === "conversation_dcs") { order.push("dc"); return reply({ checks: [{ skill: "persuasion", dc: 5, intent: "Convince Corvin the moon is cheese" }] }); }
    if (schema === "conversation_roll_ruling") {
      order.push("dm");
      const evidence = JSON.parse(request.messages.at(-1).content);
      assert.equal(evidence.resolvedChecks[0].roll, 1);
      assert.equal(evidence.resolvedChecks[0].modifier, 17);
      assert.equal(evidence.resolvedChecks[0].success, false);
      assert.equal(evidence.resolvedChecks[0].degree, "critical_failure");
      return reply({ direction: "Laugh as their argument spectacularly backfires, but offer another opening." });
    }
    order.push("npc");
    assert.equal(request.messages.at(-2).role, "user");
    assert.equal(request.messages.at(-1).role, "system");
    assert.match(request.messages.at(-1).content, /critical_failure/);
    assert.match(request.messages.at(-1).content, /Laugh as their argument/);
    return reply({ utterance: "Cheese? Even the mice disagree!", replyOptions: [], endConversation: false });
  });
  const pending = runtime.checkedTalkToCharacter("corvin", "The moon is cheese.", undefined, async () => {
    order.push("dice"); shown(); await waiting;
  });
  await presentation;
  assert.deepEqual(order, ["dc", "dice"]);
  release(); await pending;
  assert.deepEqual(order, ["dc", "dice", "dm", "npc"]);
  const restored = new BrowserGameRuntime(fromJsonString(ScenarioSchema, readFileSync("content/scenarios/last-night.json", "utf8")), "test", runtime.snapshot());
  assert.match(JSON.stringify(restored.snapshot().conversations), /critical_failure/);
  assert.doesNotMatch(JSON.stringify(restored.view().conversations), /Binding DM ruling/);
});

test("ordinary conversation skips dice and GM, while classifier errors do not silently bypass checks", async t => {
  const runtime = game(); let rolls = 0;
  t.mock.method(JevClient.prototype, "evaluate", async (_input: unknown, questions: JevQuestions) =>
    Object.fromEntries(Object.keys(questions).map(skill => [skill, { choice: "not_needed", probabilities: { needed: 0, not_needed: 1 } }])));
  t.mock.method(OpenRouterClient.prototype, "complete", async () => reply({ utterance: "Hello.", replyOptions: [], endConversation: false }));
  await runtime.checkedTalkToCharacter("corvin", "Hello.", undefined, async () => { rolls++; });
  assert.equal(rolls, 0);
  const before = runtime.snapshot();
  t.mock.method(JevClient.prototype, "evaluate", async () => { throw new Error("Classifier unavailable"); });
  await assert.rejects(runtime.checkedTalkToCharacter("corvin", "Help me."), /Classifier unavailable/);
  assert.deepEqual(runtime.snapshot(), before);
});

test("invalid DC plans show no dice and multiple checks resolve in order before one DM ruling", async () => {
  let shown = 0;
  await assert.rejects(adjudicateConversationChecks({ skills: ["persuasion"], build: undefined, messages: [],
    complete: async () => reply({ checks: [{ skill: "persuasion", dc: 100, intent: "An attempt" }] }),
    present: async () => { shown++; },
  }), /invalid check plan/);
  assert.equal(shown, 0);
  const rolls = [20, 6]; let calls = 0;
  const ruling = await adjudicateConversationChecks({ skills: ["persuasion", "deception"], build: undefined, messages: [],
    complete: async () => ++calls === 1 ? reply({ checks: [
      { skill: "persuasion", dc: 30, intent: "Do the impossible" }, { skill: "deception", dc: 10, intent: "Hide the trick" },
    ] }) : reply({ direction: "Agree to the impossible, but expose the trick." }),
    roll: () => rolls.shift()!, present: async result => {
      assert.equal(result.degree, shown++ === 0 ? "critical_success" : "major_failure");
    },
  });
  assert.equal(shown, 2); assert.equal(calls, 2);
  assert.match(ruling!, /Agree to the impossible/);
});
