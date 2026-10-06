import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { EventSchema } from "../packages/contracts/src/index.js";
import type { GameAction } from "../packages/core/src/actions.js";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

const signal = new AbortController().signal;
function setup(options: WorldOptions = {}) {
  const world = loadPlayableWorld(), map = structuredClone(world.simulation!.map!);
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
  }) } }, strategies: { resolution: { resolve: async context => { contexts.push(context); return { summary: "Agreed" }; } } } });
  const goal = "Speak to Holt";
  await runtime.overrideActiveObjective("rowan", { currentGoal: goal });
  const plan = await runtime.planNpc("rowan", signal);
  assert.equal(plan.action?.id, "custom_holt");
  assert.equal(plan.revision, map.revision);
  assert.equal((await runtime.executeNpcTalk("rowan", "custom_holt", map.revision - 1, goal, signal)).ok, false);
  assert.deepEqual(await runtime.executeNpcTalk("rowan", "custom_holt", plan.revision, goal, signal), { ok: true, text: "Agreed" });
  assert.deepEqual(contexts[0], { kind: "npc_exchange", characterId: "rowan", targetId: "holt", goal });
  const saved = runtime.snapshot();
  saved.npcActivities!.rowan!.reviewPending = true;
  saved.npcActivities!.rowan!.result = { reason: "unable", detail: "Need a new plan" };
  runtime.restore(saved);
  await runtime.reviewNpcOutcome("rowan");
  assert.equal((contexts[1] as { observation: { room: string } }).observation.room, "Replacement hall");
});

test("NPC opening speech runs conversation strategies and the character responder", async () => {
  const calls: string[] = [];
  const { runtime, map, actions, goal } = setup({ services: {
    ai: { responses: async () => { throw new Error("Bypassed character service"); } },
    character: { respond: async request => {
      calls.push("respond");
      assert.ok(request.messages.some(message => message.content === "Hook context"));
      return { role: "assistant", content: "A word, please." };
    } },
  }, strategies: { conversation: {
    respond: async (context, signal, services) => {
      calls.push("strategy"); context.request.messages.push({ role: "system", content: "Hook context" });
      return services.character.respond(context.request, signal);
    },
  } } });
  actions[1]!.type = "move";
  assert.equal((await runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal)).ok, false);
  actions[1]!.type = "talk";
  assert.deepEqual(await runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal), { ok: true, text: "A word, please." });
  assert.deepEqual(calls, ["strategy", "respond"]);
  assert.equal(runtime.snapshot().conversations.rowan!.filter(turn => (turn as { speakerId?: string }).speakerId !== "earshot").length, 1);
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
  assert.deepEqual(await runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal), { ok: true, text: "Welcome." });
});

test("world event perception uses injected rolls at the moderate hearing boundary", async () => {
  const world = loadPlayableWorld();
  const source = world.simulation!.map!.actors.find(actor => actor.characterId === "rowan")!;
  const listener = world.simulation!.map!.actors.find(actor => actor.characterId === "holt")!;
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

test("player perceives nearby physical events more reliably and clearly than NPCs", async () => {
  const world = loadPlayableWorld();
  const source = world.simulation!.map!.actors.find(actor => actor.characterId === "rowan")!;
  source.position = { $typeName: "kingmaker.v1.TilePosition", x: 58, y: 24 };
  for (const id of ["player", "holt"]) {
    world.simulation!.map!.actors.find(actor => actor.characterId === id)!.position = { ...source.position, x: 62 };
  }
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, {
    services: { random: { integer: () => 100 } },
  });
  const event = create(EventSchema, { id: "door-open", participantIds: ["rowan"], position: source.position,
    kind: "using a door", summary: "Rowan opened the hall door." });
  const result = await runtime.assessWorldEvent(event, signal);
  assert.equal(result.playerPerception, event.summary);
  assert.ok(!result.reactions.some(reaction => reaction.characterId === "holt"));
  runtime.recordPlayerPerception(event, result.playerPerception!);
  runtime.recordPlayerPerception(event, result.playerPerception!);
  const saved = runtime.snapshot();
  runtime.restore(saved);
  assert.deepEqual(runtime.snapshot().playerMessages.map(entry => entry.message), [event.summary]);
});

test("the player's own events enter the feed even without an event position", async () => {
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "");
  for (const kind of ["using a door", "interacting with an object"]) {
    const event = create(EventSchema, { id: kind, participantIds: ["player"], kind, summary: `You are ${kind}.` });
    const result = await runtime.assessWorldEvent(event, signal);
    assert.equal(result.playerPerception, event.summary);
    assert.deepEqual(result.reactions, []);
  }
  assert.equal((await runtime.assessWorldEvent(create(EventSchema, { participantIds: ["rowan"] }), signal)).playerPerception, undefined);
});


test("conversation conflicts reach the next model decision without running a resolution", async () => {
  let state = "", resolutions = 0;
  const { runtime, map } = setup({ services: { disclosure: { disclose: async () => [] },
    ai: { decisions: async observation => { state = String(observation); return { next: { choice: "wait", probabilities: {} } }; } } },
    strategies: { resolution: { resolve: async () => { resolutions++; return { summary: "Unexpected" }; } } } });
  await runtime.overrideActiveObjective("rowan", { currentGoal: "Speak to Holt" });
  const result = await runtime.executeNpcTalk("rowan", "custom_holt", map.revision - 1, "Speak to Holt", signal);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected replan feedback");
  await runtime.planNpc("rowan", signal, result);
  assert.match(state, /conversation_changed/);
  assert.match(state, /fresh observation/);
  assert.equal(resolutions, 0);
});

test("a world change during opening speech returns a replan without publishing the stale opening", async () => {
  const { runtime, map, goal } = setup({ services: { disclosure: { disclose: async () => [] },
    character: { respond: async () => { map.revision++; return { role: "assistant", content: "Too late." }; } },
  }, strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal), } } });
  const before = runtime.snapshot();
  const result = await runtime.initiatePlayerConversation("rowan", "custom_player", map.revision, goal, signal);
  assert.equal(result.ok, false);
  assert.deepEqual(runtime.snapshot().conversations, before.conversations);
  assert.deepEqual(runtime.snapshot().npcActivities, before.npcActivities);
});

test("conversation service failures remain errors", async () => {
  const { runtime, map, goal } = setup({ strategies: { resolution: { resolve: async () => { throw new Error("Provider failed"); } } } });
  await assert.rejects(runtime.executeNpcTalk("rowan", "custom_holt", map.revision, goal, signal), /Provider failed/);
});

test("conversation feed links retain separate perceived histories across save and restore", () => {
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "");
  const name = (runtime.view().characters as Array<{ id: string; name: string }>).find(character => character.id === "rowan")!.name;
  for (const [id, perception] of [["first", "player: Hello.\nrowan: Welcome."], ["second", "You hear Rowan say goodbye."]] as const) {
    const event = create(EventSchema, { id, kind: "having a conversation", participantIds: ["rowan", "player"], summary: "Unperceived details" });
    runtime.recordPlayerPerception(event, perception!);
    runtime.recordPlayerPerception(event, perception!);
  }
  runtime.restore(runtime.snapshot());
  const entries = runtime.view().playerMessages as Array<{ conversationTitle?: string; message: string }>;
  assert.deepEqual(entries.map(entry => entry.conversationTitle), [`Conversation with ${name}`, `Conversation with ${name}`]);
  assert.deepEqual(entries.map(entry => entry.message), ["player: Hello.\nrowan: Welcome.", "You hear Rowan say goodbye."]);
});
