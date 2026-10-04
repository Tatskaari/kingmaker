import { activityGoal, characterIntent } from "../packages/lore/src/activity.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { commitReview } from "./fixtures.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { create, fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema, TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { DocumentSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
import { loadConversationWorld } from "../scripts/lib/conversation-world.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { jevActionHooks } from "../packages/conversation/src/action.js";
import { documentReviewHooks } from "../packages/conversation/src/document-review.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { planWorldAction, reviewAndPlanWorldAction } from "../apps/web/src/world-action.js";

function fixture(goal?: string) {
  const world = loadPlayableWorld();
  const entry = world.characters.find(path => path.includes("/corvin/"))!;
  if (goal) assignActivity(world, "corvin", goal);
  world.docs["secret.md"] = create(DocumentSchema, { body: "GM_SECRET_SENTINEL", frontmatter: { visibility: "gm" } });
  const other = world.characters.find(path => path.includes("/elinor/"))!;
  world.docs[other]!.body += "\nOTHER_PRIVATE_SENTINEL";
  const services = createScenarioServices(world);
  return { ...services, disclosure: { disclose: async () => [] }, map: { observe: (id: string) => new WorldHost(services.scenario.snapshot()).map.observe(id) } };
}
const evidence = { characterId: "corvin", participants: ["corvin", "player"], transcript: [create(TranscriptMessageSchema, { text: "Please go to the hall." })] };

test("v2 review commits its goal before classify/resolve returns a real command without moving anyone", async () => {
  const services = fixture(), beforeMap = services.scenario.snapshot().map, order: string[] = [];
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: {
    responses: async () => { order.push("review"); return commitReview({
      summary: "Agreed", newNotes: ["The player requested a visit to the hall."], activeGoal: "Go to the hall" }); },
    decisions: async (state, questions) => {
      order.push("classify");
      assert.equal(activityGoal(services.scenario.snapshot(), "corvin"), "Go to the hall");
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

});

test("v2 idle reviews skip Jev, failed reviews stop planning, and terminal results return no command", async () => {
  const services = fixture(); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: {
    responses: async () => (commitReview({ summary: "No task", newNotes: [], activeGoal: null })),
    decisions: async () => { calls++; return { next: { choice: "wait", probabilities: {} } }; },
  } }, hooks: { review: documentReviewHooks, action: jevActionHooks } });
  assert.equal((await reviewAndPlanWorldAction(evidence, runtime)).plan, undefined); assert.equal(calls, 0);
  runtime.services.ai.responses = async () => { throw new Error("review failed"); };
  await assert.rejects(reviewAndPlanWorldAction(evidence, runtime), /review failed/); assert.equal(calls, 0);
  const active = fixture("Go to the hall");
  const activeRuntime = new ConversationRuntime({ services: { ...active, lore: documentLoreService(active.scenario), ai: runtime.services.ai }, hooks: { action: jevActionHooks } });
  assert.equal((await planWorldAction("corvin", activeRuntime))!.action, undefined); assert.equal(calls, 1);
  await assert.rejects(planWorldAction("corvin", activeRuntime, undefined, Array(24).fill("open_door")), /limit/);
  assert.equal(calls, 1);
});

test("planning tolerates document changes and still honours cancellation", async () => {
  const services = fixture("Go to the hall"), controller = new AbortController();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { decisions: async () => {
    const path = characterIntent(services.scenario.snapshot(), "corvin").activity!, doc = await services.docs.read(path);
    await services.docs.replace(path, doc.sha, "current_goal: Go to the hall", "current_goal: Go to the kitchen");
    return { next: { choice: "complete", probabilities: {} } };
  } } }, hooks: { action: jevActionHooks } });
  assert.equal((await planWorldAction("corvin", runtime))!.decision.choice, "complete");
  controller.abort();
  await assert.rejects(planWorldAction("corvin", runtime, controller.signal), /abort/i);
});
