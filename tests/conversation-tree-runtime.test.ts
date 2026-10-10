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
  await services.quests.register(tree.quest);
  const runner = new ConversationTreeSession(tree, services.quests, { "hello-world.ts": script ?? (signal => helloWorld(services.quests, signal)) });
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
  const { runner, step, services, history } = await setup(async () => { calls++; return "Hello world!"; });
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

test("script failure keeps progress unchanged and blocks automatic replay", async () => {
  let calls = 0;
  const { runner, step, services, tree } = await setup(async () => { calls++; throw new Error("script failed"); });
  await step("greeted"); await step("hinted");
  await assert.rejects(step("accepted"), /script failed/);
  assert.equal(services.quests.read(tree.quest.id).currentStageId, "cushions");
  assert.equal(runner.status.phase, "failed");
  await assert.rejects(step("accepted"), /stopped/);
  assert.equal(calls, 1);
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
