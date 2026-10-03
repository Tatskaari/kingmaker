import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { EventSchema } from "../packages/contracts/src/index.js";
import type { GameAction } from "../packages/core/src/actions.js";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

const signal = new AbortController().signal;
function setup(options: WorldOptions = {}) {
  const world = loadPlayableWorld(), map = structuredClone(world.map!);
  map.revision += 100;
  const actor = map.actors.find(actor => actor.characterId === "rowan")!;
  actor.roomId = "great_hall";
  map.rooms.find(room => room.id === actor.roomId)!.name = "Replacement hall";
  const actions: GameAction[] = ["holt", "player"].map(target => ({ id: `custom_${target}`, type: "talk" as const,
    target, description: `Talk to ${target}`, path: [{ x: 1, y: 1 }] }));
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    ...options, services: { ...options.services, map: { observe: characterId => ({ characterId, map, actions }) } },
  });
  const goal = runtime.snapshot().npcActivities!.rowan!.goal;
  return { runtime, map, actions, goal };
}

test("NPC planning, exchanges and outcome reviews use replacement map observations", async () => {
  const contexts: unknown[] = [];
  const { runtime, map } = setup({ services: { disclosure: { disclose: async () => [] }, ai: { decisions: async () => ({
    next: { choice: "custom_holt", probabilities: {} },
  }) } }, hooks: { resolution: { resolve: async context => { contexts.push(context); return { summary: "Agreed" }; } } } });
  const goal = "Speak to Holt";
  await runtime.overrideActiveObjective("rowan", { currentGoal: goal });
  const plan = await runtime.planNpc("rowan", signal);
  assert.equal(plan.action?.id, "custom_holt");
  assert.equal(plan.revision, map.revision);
  await assert.rejects(runtime.executeNpcTalk("rowan", "custom_holt", map.revision - 1, goal, signal), /replan/);
  assert.equal(await runtime.executeNpcTalk("rowan", "custom_holt", plan.revision, goal, signal), "Agreed");
  assert.deepEqual(contexts[0], { kind: "npc_exchange", characterId: "rowan", targetId: "holt", goal });
  const saved = runtime.snapshot();
  saved.npcActivities!.rowan!.reviewPending = true;
  saved.npcActivities!.rowan!.result = { reason: "complete", detail: "Done" };
  runtime.restore(saved);
  await runtime.reviewNpcOutcome("rowan");
  assert.equal((contexts[1] as { observation: { room: string } }).observation.room, "Replacement hall");
});

test("NPC opening speech runs conversation hooks and the character responder", async () => {
  const calls: string[] = [];
  const { runtime, map, actions, goal } = setup({ services: {
    ai: { responses: async () => { throw new Error("Bypassed character service"); } },
    character: { respond: async request => {
      calls.push("respond");
      assert.ok(request.messages.some(message => message.content === "Hook context"));
      return { role: "assistant", content: "A word, please." };
    } },
  }, hooks: { conversation: {
    classify: async () => { calls.push("classify"); return { docs: {} as never, checks: undefined }; },
    resolve: async context => { calls.push("resolve"); context.request.messages.push({ role: "system", content: "Hook context" }); return { reclassify: context.pass === 1 }; },
  } } });
  actions[1]!.type = "move";
  await assert.rejects(runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal), /replan/);
  actions[1]!.type = "talk";
  assert.equal(await runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal), "A word, please.");
  assert.deepEqual(calls, ["classify", "resolve", "classify", "resolve", "respond"]);
  assert.equal(runtime.snapshot().conversations.rowan!.length, 1);
  const call = runtime.recentTranscripts().find(call => call.kind === "dialogue")!;
  assert.equal(call.characterId, "rowan");
  assert.deepEqual(call.participantIds, ["rowan", "player"]);
  assert.ok(call.conversationId && call.turnId && call.spanId);
});

test("NPC opening speech uses disclosure and AI defaults and honors cancellation", async () => {
  const { runtime, map, goal } = setup({ services: { ai: {
    decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "skip", probabilities: { [id]: 0, skip: 1 } }])),
    responses: async () => ({ role: "assistant", content: "Welcome." }),
  } } });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, cancelled.signal), /abort/i);
  assert.equal(runtime.snapshot().conversations.rowan, undefined);
  assert.equal(await runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal), "Welcome.");
});

test("world event perception uses injected rolls at the moderate hearing boundary", async () => {
  const world = loadPlayableWorld();
  const source = world.map!.actors.find(actor => actor.characterId === "rowan")!;
  const listener = world.map!.actors.find(actor => actor.characterId === "holt")!;
  // Keep the listeners in the same open palace room, four tiles apart.
  source.position = { $typeName: "kingmaker.v1.TilePosition", x: 58, y: 24 };
  listener.position = { ...source.position, x: 62 };
  const rolls: number[][] = [];
  let roll = 60;
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    services: { random: { integer: (min, max) => { rolls.push([min, max]); return roll; } } },
  });
  const event = create(EventSchema, { id: "test", participantIds: ["rowan"], position: source.position, kind: "talking", summary: "A secret" });
  const heard = await runtime.assessWorldEvent(event, signal);
  assert.ok(heard.reactions.some(reaction => reaction.characterId === "holt"));
  roll = 61;
  const missed = await runtime.assessWorldEvent(event, signal);
  assert.ok(!missed.reactions.some(reaction => reaction.characterId === "holt"));
  assert.ok(rolls.length > 0);
  assert.ok(rolls.every(range => range[0] === 1 && range[1] === 100));
});
