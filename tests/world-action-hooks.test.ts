import { create } from "@bufbuild/protobuf";
import { activityGoal, characterIntent } from "../packages/lore/src/activity.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import assert from "node:assert/strict";
import test from "node:test";
import { planWorldAction,reviewAndPlanWorldAction } from "../apps/web/src/world-action.js";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { DocumentSchema } from "../packages/contracts/src/v2.js";
import { jevActionStrategy } from "../packages/conversation/src/action.js";
import { documentReviewStrategy } from "../packages/conversation/src/document-review.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { commitReview, loadPlayableWorld, assignActivity } from "./fixtures.js";

function fixture(goal?: string) {
  const world = loadPlayableWorld();
  const entry = world.characters.find(path => path.includes("/corvin/"))!;
  if (goal) assignActivity(world, "corvin", goal);
  world.docs["secret.md"] = create(DocumentSchema, { body: "GM_SECRET_SENTINEL", frontmatter: { visibility: "gm" } });
  const other = world.characters.find(path => path.includes("/elinor/"))!;
  world.docs[other]!.body += "\nOTHER_PRIVATE_SENTINEL";
  const services = createScenarioServices(world);
  return { ...services, disclosure: { disclose: async () => [] }, map: { observe: (id: string) => new WorldHost(services.scenario.read()).map.observe(id) } };
}
const evidence = { characterId: "corvin", participants: ["corvin", "player"], transcript: [create(TranscriptMessageSchema, { text: "Please go to the hall." })] };

test("v2 review commits its goal before classify/resolve returns a real command without moving anyone", async () => {
  const services = fixture(), beforeMap = services.scenario.read().simulation!.map, order: string[] = [];
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: {
    responses: async request => { order.push("review"); return commitReview({
      summary: "Agreed", newNotes: ["The player requested a visit to the hall."], activeGoal: "Go to the hall" }, request); },
    decisions: async (state, questions) => {
      order.push("classify");
      assert.equal(activityGoal(services.scenario.read(), "corvin"), "Go to the hall");
      assert.match(String(state), /Go to the hall/);
      assert.ok(!String(state).includes("GM_SECRET_SENTINEL"));
      assert.ok(!String(state).includes("OTHER_PRIVATE_SENTINEL"));
      assert.ok(!String(state).includes('"abilityScores"'));
      const choice = Object.keys(questions.next!.criteria).find(id => id.startsWith("enter_"))!;
      assert.ok(choice); return { next: { choice, probabilities: { [choice]: 1 } } };
    },
  } }, strategies: { review: documentReviewStrategy, action: { ...jevActionStrategy,
    resolve: async (...args) => { order.push("resolve"); return jevActionStrategy.resolve(...args); },
  } } });
  const result = await reviewAndPlanWorldAction(evidence, runtime);
  assert.deepEqual(order, ["review", "review", "classify", "resolve"]);
  assert.equal(result.plan!.action!.type, "move"); assert.equal(result.plan!.action!.path.length, 0, "choosing an action does not plan its route before execution");
  assert.deepEqual(services.scenario.read().simulation!.map, beforeMap);

});

test("v2 idle reviews skip Jev, failed reviews stop planning, and terminal results return no command", async () => {
  const services = fixture(); let calls = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: {
    responses: async request => (commitReview({ summary: "No task", newNotes: [], activeGoal: null }, request)),
    decisions: async () => { calls++; return { next: { choice: "wait", probabilities: {} } }; },
  } }, strategies: { review: documentReviewStrategy, action: jevActionStrategy } });
  assert.equal((await reviewAndPlanWorldAction(evidence, runtime)).plan, undefined); assert.equal(calls, 0);
  runtime.services.ai.responses = async request => { throw new Error("review failed"); };
  await assert.rejects(reviewAndPlanWorldAction(evidence, runtime), /review failed/); assert.equal(calls, 0);
  const active = fixture("Go to the hall");
  const activeRuntime = new ConversationRuntime({ services: { ...active, lore: documentLoreService(active.scenario), ai: runtime.services.ai }, strategies: { action: jevActionStrategy } });
  assert.equal((await planWorldAction("corvin", activeRuntime))!.action, undefined); assert.equal(calls, 1);
  await assert.rejects(planWorldAction("corvin", activeRuntime, undefined, Array(24).fill("open_door")), /limit/);
  assert.equal(calls, 1);
});

test("planning tolerates document changes and still honours cancellation", async () => {
  const services = fixture("Go to the hall"), controller = new AbortController();
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario), ai: { decisions: async () => {
    const path = characterIntent(services.scenario.read(), "corvin").activity!, doc = await services.docs.read(path);
    await services.docs.replace(path, doc.sha, "current_goal: Go to the hall", "current_goal: Go to the kitchen");
    return { next: { choice: "complete", probabilities: {} } };
  } } }, strategies: { action: jevActionStrategy } });
  assert.equal((await planWorldAction("corvin", runtime))!.decision.choice, "complete");
  controller.abort();
  await assert.rejects(planWorldAction("corvin", runtime, controller.signal), /abort/i);
});


test("originating dialogue and rulings reach disclosure and Jev after the review has ended", async () => {
  const services = fixture();
  const transcript = [
    create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: "Go confront those Nine Furrows delegates." }),
    create(TranscriptMessageSchema, { role: TranscriptRole.GAME_MASTER, speakerId: "gm", text: "The persuasion succeeds; confront them without treating the report as verified." }),
    create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: "corvin", text: "I will ask what they said." }),
  ];
  let decisions = 0, disclosures = 0;
  const runtime = new ConversationRuntime({ services: { ...services, lore: documentLoreService(services.scenario),
    disclosure: { disclose: async (_lore, messages) => {
      if (messages.some(message => message.content?.includes("Current execution task:"))) {
        disclosures++;
        assert.match(JSON.stringify(messages), /Go confront those Nine Furrows delegates/);
      }
      return [];
    } }, ai: {
      responses: async request => commitReview({ summary: "Agreed", newNotes: [], activeGoal: "Confront Nine Furrows" }, request),
      decisions: async state => {
        decisions++;
        for (const turn of transcript) assert.ok(String(state).includes(turn.text));
        assert.match(String(state), /Originating conversation \(historical evidence\)/);
        assert.match(String(state), /GAME_MASTER/);
        return { next: { choice: "unable", probabilities: { unable: 1 } } };
      },
    } }, strategies: { review: documentReviewStrategy, action: jevActionStrategy } });
  await reviewAndPlanWorldAction({ characterId: "corvin", participants: ["corvin", "player"], transcript }, runtime);
  // A later planning pass has no conversation argument or live conversation buffer.
  await planWorldAction("corvin", runtime);
  assert.equal(decisions, 2);
  assert.equal(disclosures, 2);
});
