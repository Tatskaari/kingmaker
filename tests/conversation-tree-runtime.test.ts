import { helloWorld } from "../packages/conversation/src/tree-scripts/hello-world.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type TranscriptMessage } from "../packages/contracts/src/index.js";
import { ConversationTreeSession, type TreeStatus, type TreeScript } from "../packages/conversation/src/conversation-tree.js";
import { parseConversationTree } from "../packages/lore/src/conversation-tree.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { conversationRequest } from "../packages/conversation/src/conversation.js";
import type { AiService } from "../packages/conversation/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";

const source = readFileSync(new URL("../content/conversation-trees/aldren.md", import.meta.url), "utf8");
async function setup(script?: TreeScript) {
  const services = createScenarioServices(loadPlayableWorld()), tree = parseConversationTree(source);
  const runner = new ConversationTreeSession(tree, services.quests, { "hello-world.ts": script ?? (signal => helloWorld(services, signal)) });
  const events: TreeStatus[] = [], signal = new AbortController().signal;
  const history: TranscriptMessage[] = [runner.goal(), create(TranscriptMessageSchema, {
    role: TranscriptRole.PLAYER, speakerId: "player", text: "Hello",
  })];
  const step = async (...hits: string[]) => {
    const ai: Pick<AiService, "decisions"> = { decisions: async (state, questions) => {
      assert.doesNotMatch(JSON.stringify(state), /Current conversation goal/);
      return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: hits.includes(id) ? "hit" : "miss", probabilities: { hit: hits.includes(id) ? 1 : 0, miss: hits.includes(id) ? 0 : 1 } }]));
    } };
    const goal = await runner.evaluate(history, ai, signal, event => events.push(event));
    if (goal) history.push(goal);
    return goal;
  };
  return { runner, services, tree, step, events, history };
}

test("misses retain the node; all branches are shown and file order breaks ties", async () => {
  const { runner, step, events, services, tree } = await setup();
  assert.equal(await step(), undefined);
  assert.equal(runner.status.node, "greeting");
  assert.equal(events.at(-1)!.conditions[0]!.decision!.choice, "miss");
  await step("greeted");
  await step("asked-for-details", "hinted");
  assert.equal(runner.status.node, "cushions");
  assert.equal(services.quests.read(tree.quest.id).history.at(-1)!.transitionId, "asked-for-details");
  assert.equal(events.find(event => event.node === "hint" && event.phase === "completed")!.conditions.length, 2);
});

test("acceptance runs the script once and supplies a system goal without reasoning or tools", async () => {
  let calls = 0;
  const { runner, step, services, history } = await setup(async () => { calls++; return { status: "accepted", message: "Hello world!" }; });
  await step("greeted"); await step("hinted"); await step("requested");
  const goal = await step("agreed");
  assert.equal(calls, 1);
  assert.equal(runner.status.node, "helping");
  assert.equal(runner.status.scriptOutput, "Hello world!");
  assert.equal(await step("agreed"), undefined);
  assert.equal(calls, 1);
  const request = conversationRequest({ world: services.currentWorld(), characterId: "aldren", sources: [], transcript: history, message: "Thanks" });
  assert.equal(request.messages.at(-2)!.role, "system");
  assert.equal(request.messages.at(-2)!.content, goal!.text);
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.tools, undefined);
});

test("refusal takes its branch without running the script", async () => {
  const { runner, step } = await setup(async () => { assert.fail("refusal must not run acceptance script"); });
  await step("greeted"); await step("hinted"); await step("refused");
  assert.equal(runner.status.node, "declined");
});

test("script failure keeps progress unchanged and the next turn retries", async () => {
  let calls = 0;
  const { runner, step, services, tree } = await setup(async () => { if (++calls === 1) throw new Error("script failed"); return { status: "accepted", message: "ok" }; });
  await step("greeted"); await step("hinted");
  await assert.rejects(step("accepted"), /script failed/);
  assert.equal(services.quests.read(tree.quest.id).currentStageId, "cushions");
  assert.equal(runner.status.phase, "failed");
  await step("accepted");
  assert.equal(calls, 2);
  assert.notEqual(services.quests.read(tree.quest.id).currentStageId, "cushions");
  assert.equal(runner.status.phase, "ready");
});

test("a failed decision call does not block later turns", async () => {
  const { runner, history, step } = await setup();
  await assert.rejects(runner.evaluate(history, { decisions: async () => { throw new Error("network"); } },
    new AbortController().signal, () => {}), /network/);
  assert.equal(runner.status.phase, "failed");
  await step("greeted");
  assert.equal(runner.status.node, "hint");
});

test("cancelled decisions cannot advance progress", async () => {
  const { runner, history, services, tree } = await setup();
  const controller = new AbortController();
  await assert.rejects(runner.evaluate(history, { decisions: async () => {
    controller.abort(); return { greeted: { choice: "hit", probabilities: { hit: 1 } } };
  } }, controller.signal, () => {}), /abort/i);
  assert.equal(services.quests.read(tree.quest.id).revision, 0);
});

test("the real TypeScript hook activates the authored quest without advancing its stage", async () => {
  const { step, services, runner } = await setup();
  const before = services.quests.read("assembly_programme");
  assert.equal(before.active, false);
  await step("greeted"); await step("hinted"); await step("accepted");
  const after = services.quests.read("assembly_programme");
  assert.equal(after.active, true);
  assert.equal(after.currentStageId, before.currentStageId);
  assert.deepEqual(after.history, before.history);
  assert.match(runner.status.scriptOutput!, /Hello world!.*now active/);
});

test("a definition edit during Jev classification discards the old decision and refreshes guidance", async () => {
  const services = createScenarioServices(loadPlayableWorld()), signal = new AbortController().signal;
  const readTree = () => {
    const doc = services.currentWorld().docs["Conversations/aldren.md"]!;
    return parseConversationTree(`---\n${JSON.stringify(doc.frontmatter)}\n---\n${doc.body}`);
  };
  const runner = new ConversationTreeSession(readTree(), services.quests, { "hello-world.ts": async () => ({ status: "accepted", message: "unused" }) }, readTree);
  const goal = await runner.evaluate([], { decisions: async () => {
    const doc = await services.docs.read("Conversations/aldren.md");
    await services.docs.replace(doc.path, doc.sha, "Greet the player.", "Give the player the revised greeting.");
    return { greeted: { choice: "hit", probabilities: { hit: 1 } } };
  } }, signal, () => {});
  assert.match(goal!.text, /revised greeting/);
  assert.equal(services.quests.read("conversation-aldren-cushions").currentStageId, "greeting");
  await runner.evaluate([], { decisions: async () => ({ greeted: { choice: "hit", probabilities: { hit: 1 } } }) }, signal, () => {});
  assert.equal(runner.status.node, "hint");
});

test("a refreshed definition preserves retries after a failed script", async () => {
  const services = createScenarioServices(loadPlayableWorld()), tree = parseConversationTree(source), signal = new AbortController().signal;
  let calls = 0, currentTree = tree;
  const runner = new ConversationTreeSession(tree, services.quests, { "hello-world.ts": async () => { calls++; throw new Error("partially executed"); } }, () => currentTree);
  await services.quests.transition(tree.quest.id, "greeted", 0);
  await services.quests.transition(tree.quest.id, "hinted", 1);
  const decide = { decisions: async (_state: unknown, questions: Record<string, unknown>) => Object.fromEntries(Object.keys(questions).map(id => [id,
    { choice: id === "accepted" ? "hit" : "miss", probabilities: { hit: id === "accepted" ? 1 : 0 } }])) };
  await assert.rejects(runner.evaluate([], decide, signal, () => {}), /partially executed/);
  const doc = await services.docs.read("Conversations/aldren.md");
  await services.docs.replace(doc.path, doc.sha, "Greet the player.", "Greet the player warmly.");
  currentTree = parseConversationTree((await services.docs.read(doc.path)).text);
  await assert.rejects(runner.evaluate([], decide, signal, () => {}), /partially executed/);
  assert.equal(calls, 2);
});


test("a hook rejection explains the unchanged goal and permits a later successful retry", async () => {
  let hasItem = false;
  const { runner, step, services, tree } = await setup(async () => hasItem
    ? { status: "accepted", message: "Item delivered." }
    : { status: "rejected", message: "The player does not have the requested item." });
  await step("greeted"); await step("hinted");
  const before = services.quests.read(tree.quest.id);
  const rejection = await step("accepted");
  assert.deepEqual(services.quests.read(tree.quest.id), before);
  assert.equal(runner.status.phase, "rejected");
  assert.equal(runner.status.result?.status, "rejected");
  assert.match(rejection!.text, /player does not have the requested item/);
  assert.equal(runner.goal().text, rejection!.text);
  assert.equal(runner.status.conditions.find(edge => edge.id === "accepted")!.decision!.choice, "hit");
  const request = conversationRequest({ world: services.currentWorld(), characterId: "aldren", sources: [],
    transcript: [runner.goal()], message: "Here you go" });
  assert.match(String(request.messages.at(-2)!.content), /player does not have the requested item/);
  assert.deepEqual(request.reasoning, { effort: "none" });
  assert.equal(request.tools, undefined);
  hasItem = true;
  const accepted = await step("accepted");
  assert.equal(runner.status.node, "helping");
  assert.equal(runner.status.result?.status, "accepted");
  assert.doesNotMatch(accepted!.text, /Transition rejected/);
  assert.equal(services.quests.read(tree.quest.id).history.length, before.history.length + 1);
});
