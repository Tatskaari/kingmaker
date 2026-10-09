import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { commitReview } from "./fixtures.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { AlertLog } from "../apps/web/src/alerts.js";
import type { WorldOptions } from "../apps/web/src/world-runtime.js";
import { activityGoal } from "../packages/lore/src/activity.js";

function game(options: WorldOptions = {}, warning?: (message: string) => void) {
  return new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, warning, { ...options, services: { disclosure: { disclose: async () => [] }, ...options.services } });
}
const reviewReply = (request: import("../packages/providers/src/openrouter.js").ChatCompletionRequest) => commitReview({ summary: "Agreed", newNotes: ["PROMISESENTINEL"], activeGoal: "Go to the great hall" }, request);
const commit = async <T>(work: () => T) => work();

test("v2 game reviews into documents, saves without v1 state, and subsequent dialogue sees edits", async () => {
  let calls = 0;
  const runtime = game({ services: { ai: { responses: async request => {
    calls++;
    if (request.tools) return reviewReply(request);
    assert.match(JSON.stringify(request), /PROMISESENTINEL/);
    assert.ok(!JSON.stringify(request).includes("ask_the_game_master"));
    return { role: "assistant", content: "I remember." };
  } } }, strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal), } } });
  assert.equal(runtime.view().phase, "conversations");
  runtime.endConversationAsPlayer("rowan", "Please go to the hall.");
  await runtime.endConversation("rowan");
  const path = runtime.world().characters.find(path => path.endsWith("/rowan/character.md"))!;
  assert.equal(activityGoal(runtime.world(), "rowan"), "Go to the great hall");
  assert.equal(runtime.debugDocuments().characterPaths.rowan, path);
  assert.equal(runtime.debugDocuments().characterPaths.player, runtime.world().player);
  assert.equal(runtime.snapshot().conversations.rowan, undefined);
  assert.equal(runtime.snapshot().npcActivities!.rowan!.status, "active");
  const saved = JSON.parse(JSON.stringify(runtime.snapshot()));
  assert.equal(saved.scenario, undefined);
  runtime.restore(saved);
  assert.equal(await runtime.checkedTalkToCharacter("rowan", "What did we agree?"), "I remember.");
  assert.equal(calls, 3);
  assert.throws(() => runtime.restore({ ...saved, version: 2 }), /fresh game/);
});

test("v2 planning and physical execution use the live state", async () => {
  const runtime = game({ services: { ai: { responses: async request => reviewReply(request),
    decisions: async (_state, questions) => ({ next: { choice: Object.keys(questions.next!.criteria).find(id => !["complete", "wait", "unable"].includes(id))!, probabilities: {} } }),
  } } });
  runtime.endConversationAsPlayer("rowan", "Go to the hall.");
  await runtime.endConversation("rowan");
  const signal = new AbortController().signal;
  const plan = await runtime.planNpc("rowan", signal);
  assert.ok(plan.action);
  const result = await runtime.stepNpcAction("rowan", plan.action.id, plan.goal);
  assert.equal(typeof result.done, "boolean");
  assert.ok(!("generations" in plan));
  assert.ok(!("generations" in result));
  assert.ok(!("generations" in runtime.snapshot()));
  assert.ok(!("generations" in runtime.view()));
  await runtime.overrideActiveObjective("rowan", { currentGoal: "Speak to Holt" });
  assert.equal(runtime.snapshot().npcActivities!.rowan!.goal, "Speak to Holt");
});

test("concurrent reviews update separate live documents while player movement survives", async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = game({ services: { ai: { responses: async request => {
    const id = JSON.parse(request.messages.find(message => message.role === "user" && message.content?.startsWith('{"characterId"'))!.content!).characterId;
    if (++calls === 2) started();
    await gate;
    return commitReview({ summary: "Reviewed", newNotes: [`${id} remembered this exchange.`], activeGoal: null }, request);
  } } } });
  runtime.endConversationAsPlayer("corvin", "Goodbye.");
  runtime.endConversationAsPlayer("aldren", "Goodbye.");
  const reviews = Promise.all([runtime.endConversation("corvin"), runtime.endConversation("aldren")]);
  await ready;
  const destination = runtime.map.observe("player", "inspect_palace_hall_cabinet").actions.find(action => action.path.length > 1)!.path[1]!;
  await runtime.movePlayer(destination);
  release(); await reviews;
  for (const id of ["corvin", "aldren"]) {
    assert.match(runtime.world().docs[`Scenarios/Centennial Assembly/Characters/${id}/character.md`]!.body, new RegExp(`${id} remembered`));
    assert.equal(runtime.snapshot().conversations[id], undefined);
  }
  const position = runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "player")!.position!;
  assert.equal(position.x, destination.x); assert.equal(position.y, destination.y);
});

test("conversation spans retain turn, retry, review and scenario context", async () => {
  let attempts = 0;
  const alerts = new AlertLog();
  const runtime = game({ services: { ai: { responses: async request => {
    if (request.tools) return reviewReply(request);
    if (++attempts === 1) throw new TypeError("Temporary transport failure");
    return { role: "assistant", content: "Hello." };
  } } }, strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal), } } }, message => alerts.add("warning", message));
  await runtime.checkedTalkToCharacter("rowan", "Hello");
  assert.equal(alerts.severity, "warning");
  assert.equal(alerts.unread, 1);
  assert.match(alerts.entries[0]!.message, /retry 1\/1.*Temporary transport failure/);
  await runtime.checkedTalkToCharacter("rowan", "Goodbye");
  await runtime.endConversation("rowan");
  const runs = Object.values(runtime.transcriptRuns());
  assert.equal(runs.length, 1);
  const run = runs[0]!;
  assert.equal(run.status, "success");
  assert.deepEqual(run.calls.map(call => call.kind), ["dialogue", "dialogue", "dialogue", "conversation_review", "conversation_review"]);
  assert.deepEqual(run.calls.map(call => call.status), ["error", "success", "success", "success", "success"]);
  assert.equal(new Set(run.calls.map(call => call.spanId)).size, 5);
  assert.equal(new Set(run.calls.map(call => call.turnId)).size, 3);
  assert.equal(run.calls[0]!.turnId, run.calls[1]!.turnId);
  assert.ok(run.calls.every(call => call.conversationId === run.conversationId && call.scenario && call.location));
  assert.ok(run.calls.every(call => call.characterId === "rowan" && call.participantIds.includes("player")));
  await runtime.checkedTalkToCharacter("rowan", "Hello again");
  assert.notEqual(runtime.recentTranscripts()[0]!.conversationId, run.conversationId);
});

test("parallel characters and injected character responders remain separately traced", async () => {
  const runtime = game({ services: { character: { respond: async () => ({ role: "assistant", content: "Yes." }) } },
    strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal), } } });
  await Promise.all([runtime.checkedTalkToCharacter("rowan", "Hello"), runtime.checkedTalkToCharacter("corvin", "Hello")]);
  const calls = runtime.recentTranscripts();
  assert.equal(calls.length, 2);
  assert.equal(new Set(calls.map(call => call.characterId)).size, 2);
  assert.equal(new Set(calls.map(call => call.conversationId)).size, 2);
});

test("document tool history identifies concurrent reviews and remains session-only", async () => {
  const runtime = game({ services: { ai: { responses: async request => {
    const { characterId } = JSON.parse(request.messages.find(message => message.role === "user" && message.content?.startsWith('{"characterId"'))!.content!);
    return commitReview({ summary: `${characterId} review`, newNotes: [`${characterId} remembers.`], activeGoal: null }, request);
  } } } });
  for (const id of ["rowan", "corvin"]) runtime.endConversationAsPlayer(id, "Goodbye.");
  await Promise.all([runtime.endConversation("rowan"), runtime.endConversation("corvin")]);
  const { history } = runtime.debugDocuments();
  assert.equal(history.length, 2);
  for (const write of history) {
    assert.ok(write.path.endsWith(`/${write.call.characterId}/character.md`));
    assert.equal(write.call.kind, "conversation_review");
    assert.notEqual(write.beforeSha, write.afterSha);
    assert.match(JSON.stringify(write.call.response), new RegExp(`${write.call.characterId} remembers`));
  }
  const reloaded = new WorldGameRuntime(loadPlayableWorld(), "", runtime.snapshot());
  assert.deepEqual(reloaded.debugDocuments().history, []);
  runtime.endConversationAsPlayer("rowan", "Goodbye again.");
  await runtime.endConversation("rowan");
  assert.equal(runtime.debugDocuments().history.length, 2, "An unchanged review adds no history");
  runtime.resetCharacters();
  assert.deepEqual(runtime.debugDocuments().history, []);
});

test("a failed save does not appear as a document tool update", async () => {
  const runtime = game({ services: { ai: { responses: async request => reviewReply(request) } } });
  runtime.endConversationAsPlayer("rowan", "Remember this.");
  runtime.setPersistence(async work => {
    const before = runtime.snapshot();
    await work();
    runtime.restore(before);
    throw new Error("Save failed");
  });
  await assert.rejects(runtime.endConversation("rowan"), /Save failed/);
  assert.deepEqual(runtime.debugDocuments().history, []);
});

test("replacing an activity with the same current goal starts a fresh run", async () => {
  const runtime = game();
  await runtime.overrideActiveObjective("corvin", { name: "First", currentGoal: "Go to the hall" });
  runtime.finishNpcRun("corvin", "unable", "Blocked");
  assert.equal(runtime.snapshot().npcActivities!.corvin!.reviewPending, true);
  await runtime.overrideActiveObjective("corvin", { name: "Second", currentGoal: "Go to the hall" });
  assert.equal(runtime.hasActiveObjective("corvin"), true);
  assert.equal(runtime.snapshot().npcActivities!.corvin!.reviewPending, undefined);
});

test("conversation history is published before review and survives failed review reloads without duplicates", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const published: unknown[] = [];
  const runtime = game({ services: { presentation: { renderMap: async () => {
    published.push(runtime.view().playerMessages);
  } } }, strategies: { review: { resolve: async () => {
    started();
    await gate;
    throw new Error("Review failed");
  } } } });
  runtime.endConversationAsPlayer("rowan", "Remember this conversation.");
  const review = runtime.endConversation("rowan");
  await ready;
  const messages = runtime.snapshot().playerMessages;
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.conversationTitle!, /Rowan/);
  assert.equal(messages[0]!.message, "player: Remember this conversation.");
  assert.deepEqual(published, [messages]);
  assert.ok(runtime.snapshot().conversations.rowan?.length);
  const failed = assert.rejects(review, /Review failed/);
  release();
  await failed;
  const restored = new WorldGameRuntime(loadPlayableWorld(), "", JSON.parse(JSON.stringify(runtime.snapshot())), undefined, undefined,
    { strategies: { review: { resolve: async () => ({ summary: "Reviewed" }) } } });
  const event = await restored.endConversation("rowan");
  assert.equal(event!.id, messages[0]!.id);
  restored.recordPlayerPerception(event!, event!.summary);
  assert.deepEqual(restored.snapshot().playerMessages, messages);
  assert.equal(restored.snapshot().conversations.rowan, undefined);
  assert.equal(restored.snapshot().pendingConversationEvents?.rowan, undefined);
  assert.equal(await restored.endConversation("rowan"), undefined);
  restored.endConversationAsPlayer("rowan", "Remember this conversation.");
  await restored.endConversation("rowan");
  assert.equal(restored.snapshot().playerMessages.length, 2);
});

const noChecks = (questions: Record<string, unknown>) => Object.fromEntries(Object.keys(questions).map(id =>
  [id, { choice: id.startsWith("open_") ? "skip" : "not_needed", probabilities: { [id]: 0, skip: 1 } }]));
const selected = (choice: string) => ({ choice, probabilities: { [choice]: 1 } });

test("main game releases the NPC to act on newly assigned activity while live review is pending", async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  let liveFinished = false, finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  const runtime = game({ services: { debug: { record: event => { if (event.source === "live-review") finished(); } }, ai: {
    decisions: async (_state, questions, _signal, purpose) => purpose === "conversation_attention"
      ? { immediate_commitment: selected("flagged"), immediate_feasibility: selected("possible") }
      : questions.next ? { next: selected("wait") } : noChecks(questions),
    responses: async request => {
      if (!request.tools) return { role: "assistant", content: "I will meet you in the great hall." };
      const live = JSON.stringify(request.messages).includes("newly accepted conversation turn");
      assert.equal(live, true, "Ending a live conversation must not run a full review");
      const reply = reviewReply(request);
      if (reply.content) { started(); await gate; liveFinished = true; }
      return reply;
    },
  } } });
  assert.equal(await runtime.checkedTalkToCharacter("rowan", "Meet me in the hall."), "I will meet you in the great hall.");
  await ready;
  await assert.rejects(runtime.planNpc("rowan", new AbortController().signal), /paused for conversation/);
  await runtime.endConversation("rowan");
  assert.equal(liveFinished, false, "Ending the conversation must not wait for the GM");
  const plan = await runtime.planNpc("rowan", new AbortController().signal);
  assert.equal(plan.goal, "Go to the great hall");
  const action = runtime.map.observe("rowan").actions.find(action => action.path.length > 1);
  assert.ok(action, "The NPC has an action requiring movement");
  const walking = runtime.stepNpcAction("rowan", action.id, plan.goal);
  for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(runtime.world().simulation!.map!.actors.find(actor => actor.characterId === "rowan")!.movement);
  assert.equal(liveFinished, false, "Movement starts before the final GM response");
  await runtime.movement.cancel("rowan");
  await walking;
  release(); await done;
  assert.equal(liveFinished, true);
  assert.equal(activityGoal(runtime.world(), "rowan"), "Go to the great hall");
  assert.equal((await runtime.planNpc("rowan", new AbortController().signal)).goal, "Go to the great hall");
  assert.equal(runtime.snapshot().conversations.rowan, undefined);
  assert.ok(runtime.recentTranscripts().some(call => call.kind === "conversation_review"
    && JSON.stringify(call.request).includes("newly accepted conversation turn")));
});

test("main game displays discretion replies and accepts another turn while review is pending", { timeout: 30000 }, async () => {
  const displayed: string[] = [];
  let release!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  let reviews = 0;
  const runtime = game({ services: { debug: { record: event => {
    if (event.source === "live-review" && ++reviews === 2) finished();
  } }, ai: {
    decisions: async (_state, questions, _signal, purpose) => purpose === "conversation_attention"
      ? { immediate_commitment: selected("flagged"), immediate_feasibility: selected("gms_discretion") } : noChecks(questions),
    responses: async request => {
      assert.equal(request.response_format, undefined, "No GM approval call");
      if (!request.tools) return { role: "assistant", content: "I will meet you in the hall." };
      await gate;
      return reviewReply(request);
    },
  } } });
  try {
    for (const message of ["Meet me in the hall.", "See you there."]) {
      await runtime.checkedTalkToCharacter("rowan", message, undefined, {}, undefined, text => {
        assert.equal(activityGoal(runtime.world(), "rowan"), "Go to the parlour");
        displayed.push(text);
      });
    }
    assert.deepEqual(displayed, ["I will meet you in the hall.", "I will meet you in the hall."]);
    assert.equal(reviews, 0);
    await runtime.endConversation("rowan");
  } finally { release(); }
  await done;
  assert.equal(activityGoal(runtime.world(), "rowan"), "Go to the great hall");
  assert.ok(!runtime.recentTranscripts().some(call => call.kind === "gm_consultation"));
});
