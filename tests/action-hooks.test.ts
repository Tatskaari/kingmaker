import assert from "node:assert/strict";
import test from "node:test";
import { actionCriteria, jevActionHooks, runAction, type ActionContext } from "../packages/conversation/src/action.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { jevRequest } from "../packages/providers/src/jev.js";

function context(): ActionContext {
  const actions = [{ id: "enter_hall", type: "move" as const, target: "hall", description: "Enter hall", path: [{ x: 1, y: 1 }] }];
  return { characterId: "alice", goal: "Go to the hall", actions,
    request: jevRequest("In the bedroom", "Choose next action", actionCriteria(actions)) };
}

test("action hooks classify then resolve a detached command without executing it", async () => {
  const input = context(), order: string[] = [];
  const runtime = new ConversationRuntime({ services: { ai: { decisions: async (state, questions) => {
    order.push("decisions"); assert.equal(state, input.request.state);
    assert.ok(questions.next!.criteria.enter_hall);
    return { next: { choice: "enter_hall", probabilities: { enter_hall: 1 } } };
  } } }, hooks: { action: { ...jevActionHooks, classify: async (view, signal, services) => {
    order.push("classify");
    view.actions[0]!.target = "accidental mutation";
    return jevActionHooks.classify(view, signal, services);
  }, resolve: async (...args) => { order.push("resolve"); return jevActionHooks.resolve(...args); } } } });
  const result = await runAction(input, runtime);
  assert.deepEqual(order, ["classify", "decisions", "resolve"]);
  assert.deepEqual(result.action, input.actions[0]);
  result.action!.path[0]!.x = 100;
  assert.equal(input.actions[0]!.path[0]!.x, 1);
});

test("terminal judgments return no command; invalid choices and idle goals fail", async () => {
  for (const choice of ["complete", "wait", "unable", "invented"]) {
    const runtime = new ConversationRuntime({ hooks: { action: { ...jevActionHooks,
      classify: async () => ({ choice, probabilities: {} }) } } });
    if (choice === "invented") await assert.rejects(runAction(context(), runtime), /unavailable/);
    else assert.equal((await runAction(context(), runtime)).action, undefined);
    await assert.rejects(runAction({ ...context(), goal: " " }, runtime), /active goal/);
  }
});

test("cancellation between classification and resolution never resolves", async () => {
  const controller = new AbortController();
  const runtime = new ConversationRuntime({ hooks: { action: {
    classify: async () => { controller.abort(); return { choice: "complete", probabilities: {} }; },
    resolve: async () => assert.fail("Cancelled decision must not resolve"),
  } } });
  await assert.rejects(runAction(context(), runtime, controller.signal), /abort/i);
  await assert.rejects(runAction(context(), new ConversationRuntime()), /hooks.action.classify/);
});

test("review activates the injected action pipeline through headless reloads and forks", async () => {
  const { readFileSync } = await import("node:fs");
  const { fromJsonString } = await import("@bufbuild/protobuf");
  const { ScenarioSchema } = await import("../packages/contracts/src/index.js");
  const { HeadlessGame } = await import("../packages/headless/src/index.js");
  let classifications = 0, resolutions = 0;
  const game = new HeadlessGame(fromJsonString(ScenarioSchema,
    readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")), "", undefined,
  { services: { ai: { responses: async () => ({ role: "assistant", content: JSON.stringify({ newNotes: [], relationships: [],
    goalUpdate: { goal: "Go to the hall", reason: "Agreed" }, lore: null }) }) } } },
  { hooks: { action: {
    classify: async context => { classifications++; assert.equal(context.goal, "Go to the hall"); return { choice: "wait", probabilities: {} }; },
    resolve: async (...args) => { resolutions++; return jevActionHooks.resolve(...args); },
  } } });
  game.runtime.createDevelopmentPlayer();
  game.runtime.endConversationAsPlayer("corvin", "Go to the hall");
  await game.endConversation("corvin");
  game.load(game.snapshot());
  for (const runtime of [game.runtime, game.runtime.forkForNpc(), game.runtime.forkForResourceReview(async work => work())]) {
    const before = runtime.snapshot();
    assert.equal((await runtime.planNpc("corvin", new AbortController().signal)).decision.choice, "wait");
    assert.deepEqual(runtime.snapshot(), before);
  }
  assert.equal(classifications, 3); assert.equal(resolutions, 3);
});
