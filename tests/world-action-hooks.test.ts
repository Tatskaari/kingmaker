import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { DocumentSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { jevActionHooks } from "../packages/conversation/src/action.js";
import { documentReviewHooks } from "../packages/conversation/src/document-review.js";
import { planWorldAction, reviewAndPlanWorldAction, assertWorldActionCurrent } from "../apps/web/src/world-action.js";

function fixture(goal?: string) {
  const world = loadPlayableWorld();
  const entry = world.characters.find(path => path.includes("/corvin/"))!;
  if (goal) world.docs[entry]!.frontmatter!.active_goal = goal;
  world.docs["secret.md"] = create(DocumentSchema, { body: "GM_SECRET_SENTINEL", frontmatter: { visibility: "gm" } });
  const other = world.characters.find(path => path.includes("/elinor/"))!;
  world.docs[other]!.body += "\nOTHER_PRIVATE_SENTINEL";
  const services = createScenarioServices(world);
  return { ...services, map: { observe: (id: string) => new WorldHost(services.scenario.snapshot()).map.observe(id) } };
}
const evidence = { characterId: "corvin", participants: ["corvin", "player"], transcript: [create(TranscriptMessageSchema, { text: "Please go to the hall." })] };

test("v2 review commits its goal before classify/resolve returns a real command without moving anyone", async () => {
  const services = fixture(), beforeMap = services.scenario.snapshot().map, order: string[] = [];
  const runtime = new ConversationRuntime({ services: { ...services, ai: {
    responses: async () => { order.push("review"); return { role: "assistant", content: JSON.stringify({
      summary: "Agreed", newNotes: ["The player requested a visit to the hall."], activeGoal: "Go to the hall" }) }; },
    decisions: async (state, questions) => {
      order.push("classify");
      assert.equal((await services.docs.read(characterEntry(services.scenario.info(), "corvin"))).document.frontmatter!.active_goal, "Go to the hall");
      assert.match(String(state), /Go to the hall/);
      assert.ok(!String(state).includes("GM_SECRET_SENTINEL"));
      assert.ok(!String(state).includes("OTHER_PRIVATE_SENTINEL"));
      assert.ok(!String(state).includes('"abilityScores"'));
      const choice = Object.keys(questions.next!.criteria).find(id => id.startsWith("enter_"))!;
      assert.ok(choice); return { next: { choice, probabilities: { [choice]: 1 } } };
    },
  } }, hooks: { review: documentReviewHooks, action: { ...jevActionHooks,
    resolve: async (...args) => { order.push("resolve"); return jevActionHooks.resolve(...args); },
  } } });
  const result = await reviewAndPlanWorldAction(evidence, runtime);
  assert.deepEqual(order, ["review", "classify", "resolve"]);
  assert.equal(result.plan!.action!.type, "move"); assert.ok(result.plan!.action!.path.length);
  assert.deepEqual(services.scenario.snapshot().map, beforeMap);
  await assertWorldActionCurrent(services.scenario.snapshot(), result.plan!);
  const changed = services.scenario.snapshot(); changed.map!.doors[0]!.open = !changed.map!.doors[0]!.open;
  await assert.rejects(assertWorldActionCurrent(changed, result.plan!), /World changed/);
});

test("v2 idle reviews skip Jev, failed reviews stop planning, and terminal results return no command", async () => {
  const services = fixture(); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, ai: {
    responses: async () => ({ role: "assistant", content: JSON.stringify({ summary: "No task", newNotes: [], activeGoal: null }) }),
    decisions: async () => { calls++; return { next: { choice: "wait", probabilities: {} } }; },
  } }, hooks: { review: documentReviewHooks, action: jevActionHooks } });
  assert.equal((await reviewAndPlanWorldAction(evidence, runtime)).plan, undefined); assert.equal(calls, 0);
  runtime.services.ai.responses = async () => { throw new Error("review failed"); };
  await assert.rejects(reviewAndPlanWorldAction(evidence, runtime), /review failed/); assert.equal(calls, 0);
  const active = fixture("Go to the hall");
  const activeRuntime = new ConversationRuntime({ services: { ...active, ai: runtime.services.ai }, hooks: { action: jevActionHooks } });
  assert.equal((await planWorldAction("corvin", activeRuntime))!.action, undefined); assert.equal(calls, 1);
  await assert.rejects(planWorldAction("corvin", activeRuntime, undefined, Array(24).fill("open_door")), /limit/);
  assert.equal(calls, 1);
});

test("v2 rejects decisions made against changed documents and cancelled requests", async () => {
  const services = fixture("Go to the hall"), controller = new AbortController();
  const runtime = new ConversationRuntime({ services: { ...services, ai: { decisions: async () => {
    const path = characterEntry(services.scenario.info(), "corvin"), doc = await services.docs.read(path);
    await services.docs.replace(path, doc.sha, "Go to the hall", "Go to the kitchen");
    return { next: { choice: "complete", probabilities: {} } };
  } } }, hooks: { action: jevActionHooks } });
  await assert.rejects(planWorldAction("corvin", runtime), /World changed/);
  controller.abort();
  await assert.rejects(planWorldAction("corvin", runtime, controller.signal), /abort/i);
});
