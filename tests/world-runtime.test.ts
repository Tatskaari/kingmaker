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
const reviewReply = { role: "assistant" as const, content: JSON.stringify({ summary: "Agreed", newNotes: ["PROMISESENTINEL"], activeGoal: "Go to the great hall" }) };
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
