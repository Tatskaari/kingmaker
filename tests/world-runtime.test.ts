import { commitReview } from "./fixtures.js";
import { loadPlayableWorld } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { readVault } from "../scripts/lib/lore-access.js";
import { playableWorld } from "../apps/web/src/playable-world.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import type { WorldOptions } from "../apps/web/src/world-runtime.js";
import { activeGoal } from "../packages/lore/src/active-goal.js";

function game(options: WorldOptions = {}) {
  return new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, options);
}
const reviewReply = commitReview({ summary: "Agreed", newNotes: ["PROMISESENTINEL"], activeGoal: "Go to the great hall" });
const commit = async <T>(work: () => T) => work();

test("v2 game reviews into documents, saves without v1 state, and subsequent dialogue sees edits", async () => {
  let calls = 0;
  const runtime = game({ services: { ai: { responses: async request => {
    calls++;
    if (calls === 1) return reviewReply;
    assert.match(JSON.stringify(request), /PROMISESENTINEL/);
    assert.ok(!JSON.stringify(request).includes("ask_the_game_master"));
    return { role: "assistant", content: "I remember." };
  } } }, hooks: { conversation: { classify: async () => ({ docs: {} as never, checks: undefined }), resolve: async () => ({ reclassify: false }) } } });
  assert.equal(runtime.view().phase, "conversations");
  runtime.endConversationAsPlayer("rowan", "Please go to the hall.");
  await runtime.endConversation("rowan");
  const path = runtime.world().characters.find(path => path.endsWith("/rowan/character.md"))!;
  assert.equal(activeGoal(runtime.world().docs[path]!), "Go to the great hall");
  assert.equal(runtime.snapshot().conversations.rowan, undefined);
  assert.equal(runtime.snapshot().npcActivities!.rowan!.status, "active");
  const saved = JSON.parse(JSON.stringify(runtime.snapshot()));
  assert.equal(saved.scenario, undefined);
  runtime.restore(saved);
  assert.equal(await runtime.checkedTalkToCharacter("rowan", "What did we agree?"), "I remember.");
  assert.equal(calls, 2);
  assert.throws(() => runtime.restore({ ...saved, version: 1 }), /fresh game/);
});

test("v2 planning and physical execution use the live state", async () => {
  const runtime = game({ services: { ai: { responses: async () => reviewReply,
    decisions: async (_state, questions) => ({ next: { choice: Object.keys(questions.next!.criteria).find(id => !["complete", "wait", "unable"].includes(id))!, probabilities: {} } }),
  } } });
  runtime.endConversationAsPlayer("rowan", "Go to the hall.");
  await runtime.endConversation("rowan");
  const signal = new AbortController().signal;
  const plan = await runtime.planNpc("rowan", signal);
  assert.ok(plan.action);
  const result = runtime.stepNpcAction("rowan", plan.action.id, plan.goal, plan.generations);
  assert.ok(result.generations["actor:rowan"]);
  await runtime.overrideActiveObjective("rowan", { currentGoal: "Speak to Holt" });
  assert.equal(runtime.snapshot().npcActivities!.rowan!.goal, "Speak to Holt");
});

test("concurrent reviews update separate live documents while player movement survives", async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = game({ services: { ai: { responses: async request => {
    const id = JSON.parse(request.messages[1]!.content!).characterId;
    if (++calls === 2) started();
    await gate;
    return commitReview({ summary: "Reviewed", newNotes: [`${id} remembered this exchange.`], activeGoal: null });
  } } } });
  runtime.endConversationAsPlayer("corvin", "Goodbye.");
  runtime.endConversationAsPlayer("aldren", "Goodbye.");
  const reviews = Promise.all([runtime.endConversation("corvin"), runtime.endConversation("aldren")]);
  await ready;
  const destination = runtime.map.observe("player").actions.find(action => action.path.length > 1)!.path[1]!;
  runtime.movePlayer(destination);
  release(); await reviews;
  for (const id of ["corvin", "aldren"]) {
    assert.match(runtime.world().docs[`Scenarios/Centennial Assembly/Characters/${id}/character.md`]!.body, new RegExp(`${id} remembered`));
    assert.equal(runtime.snapshot().conversations[id], undefined);
  }
  const position = runtime.world().map!.actors.find(actor => actor.characterId === "player")!.position!;
  assert.equal(position.x, destination.x); assert.equal(position.y, destination.y);
});
