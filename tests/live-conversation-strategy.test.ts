import assert from "node:assert/strict";
import test from "node:test";
import { ConversationReviews, liveConversationStrategy } from "../packages/conversation/src/live-conversation-strategy.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runConversation } from "../packages/conversation/src/phases.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { commitReview, loadPlayableWorld } from "./fixtures.js";
import type { OpenRouterMessage } from "../packages/providers/src/openrouter.js";

const choice = (value: string) => ({ choice: value, probabilities: { [value]: 1 } });
function fixture(mode: "background" | "discretion" | "error") {
  const backing = createScenarioServices(loadPlayableWorld());
  const before = backing.scenario.read();
  const reviews = new ConversationReviews();
  const drafts: OpenRouterMessage[][] = [], events: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = new ConversationRuntime({ services: { ...backing, lore: documentLoreService(backing.scenario),
    debug: { record: event => { events.push(event.source); } },
    character: { respond: async request => {
      drafts.push(structuredClone([...request.messages]));
      return { role: "assistant", content: drafts.length === 1 ? "I will give you a bird." : "I cannot give that away." };
    } },
    ai: { decisions: async (_state, questions, _signal, purpose) => {
      if (purpose === "prog_disc") return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "skip", probabilities: { skip: 1, [id]: 0 } }]));
      if (mode === "error") throw new Error("Jev unavailable");
      return { immediate_commitment: choice("flagged"), immediate_feasibility: choice(mode === "background" ? "possible" : "gms_discretion") };
    }, responses: async request => {
      assert.equal(request.response_format, undefined, "No blocking GM approval");
      assert.equal(request.reasoning?.effort, "high");
      await gate;
      assert.deepEqual(request.tools?.map(tool => tool.function.name), ["set_activity"]);
      return commitReview({ summary: "Recorded", newNotes: [], activeGoal: "Fetch the promised bird" }, request);
    } },
  }, strategies: { conversation: liveConversationStrategy({ characterId: "corvin", reviews }) } });
  return { runtime, reviews, before, backing, drafts, events, release };
}
const request = { model: "test", messages: [{ role: "user" as const, content: "Give me a bird." },
  { role: "system" as const, content: "# Binding DM ruling\nPersuasion succeeded." }] };

test("ordinary flags release a response while GM review remains pending", async () => {
  const f = fixture("background");
  const reply = await runConversation(request, f.runtime);
  assert.equal(reply.content, "I will give you a bird.");
  assert.deepEqual(f.backing.scenario.read(), f.before);
  assert.ok(!f.events.includes("live-review"));
  f.release(); await f.reviews.drain();
  assert.ok(f.events.includes("live-review"));
  assert.notDeepEqual(f.backing.scenario.read(), f.before);
});

test("GM discretion releases successive replies while its ordered reviews are pending", { timeout: 30000 }, async () => {
  const f = fixture("discretion");
  try {
    const first = await runConversation(request, f.runtime);
    assert.equal(first.content, "I will give you a bird.");
    const second = await runConversation(request, f.runtime);
    assert.equal(second.content, "I cannot give that away.");
    assert.deepEqual(f.backing.scenario.read(), f.before);
    assert.equal(f.events.filter(event => event === "live-accepted").length, 2);
    assert.ok(!f.events.includes("live-review"));
  } finally { f.release(); await f.reviews.drain(); }
  assert.equal(f.events.filter(event => event === "live-review").length, 2);
  assert.notDeepEqual(f.backing.scenario.read(), f.before);
});

test("classifier errors fail closed without world effects", async () => {
  const f = fixture("error");
  await assert.rejects(runConversation(request, f.runtime), /Jev unavailable/);
  assert.deepEqual(f.backing.scenario.read(), f.before);
  assert.ok(!f.events.includes("live-accepted"));
});

test("background failures surface on drain and prevent later jobs from overtaking them", async () => {
  const reviews = new ConversationReviews();
  reviews.enqueue(async () => { throw new Error("Review failed"); });
  reviews.enqueue(async () => { assert.fail("Must not overtake failed review"); });
  await assert.rejects(reviews.drain(), /Review failed/);
});

test("the full conversation strategy retains dice adjudication before background review", async () => {
  const { conversationStrategy } = await import("../packages/conversation/src/conversation-strategy.js");
  const { DisclosureSession } = await import("../packages/conversation/src/disclosure.js");
  const f = fixture("discretion");
  const original = f.runtime.services.ai.decisions;
  let rolls = 0, skillClassifications = 0;
  f.runtime.services.ai.decisions = async (...args) => {
    if (args[3] === "skill_check") {
      skillClassifications++;
      return Object.fromEntries(Object.keys(args[1]).map(skill => [skill, choice(skill === "persuasion" ? "needed" : "not_needed")]));
    }
    if (args[3] === "skill_difficulty") return { persuasion: choice("normal") };
    return original(...args);
  };
  const respond = f.runtime.services.ai.responses;
  f.runtime.services.ai.responses = async (request, ...rest) => {
    if ((request.response_format?.json_schema as { name?: string } | undefined)?.name === "conversation_roll_ruling") return { role: "assistant", content: JSON.stringify({ direction: "Agree to help; respect established ownership." }) };
    return respond(request, ...rest);
  };
  const disclosure = new DisclosureSession({ initial: [], links: () => [], open: async () => { throw new Error("Unexpected disclosure"); } }, f.runtime.services.ai);
  f.runtime.strategies.conversation = conversationStrategy(disclosure, f.runtime.services.ai, undefined, "Give me a bird.",
    async () => { rolls++; return 20; }, () => {}, () => {}, {}, {}, { services: f.runtime.services, characterId: "corvin" },
    () => {}, liveConversationStrategy({ characterId: "corvin", reviews: f.reviews }));
  const reply = await runConversation({ ...request, messages: [request.messages[0]!] }, f.runtime);
  assert.equal(reply.content, "I will give you a bird.");
  assert.equal(rolls, 1); assert.equal(skillClassifications, 1);
  assert.equal(f.drafts.length, 1);
  assert.ok(f.drafts[0]!.some(message => message.content?.startsWith("# Binding DM ruling")));
  f.release(); await f.reviews.drain();
});

test("flags schedule one combined activity review and separate focused reviews in order", async () => {
  const f = fixture("background"), categories: string[] = [], labelSets: string[][] = [];
  const decisions = f.runtime.services.ai.decisions;
  f.runtime.services.ai.decisions = async (state, questions, signal, purpose) => purpose === "conversation_attention" ? {
    immediate_commitment: choice("flagged"), deferred_commitment: choice("flagged"), general_commitment: choice("flagged"),
    immediate_feasibility: choice("gms_discretion"), improvised_detail: choice("flagged"), plot_progress: choice("flagged"),
    other_world_update: choice("flagged"), conversational_exchange: choice("flagged"), relationship_or_knowledge_change: choice("flagged"),
  } : decisions(state, questions, signal, purpose);
  f.runtime.services.debug.record = event => {
    if (event.source === "live-review") categories.push((event.output as { category: string }).category);
  };
  f.runtime.services.ai.responses = async request => {
    const evidence = request.messages.flatMap(message => {
      try { const value = JSON.parse(message.content ?? ""); return value.labels ? [value] : []; } catch { return []; }
    })[0]!;
    labelSets.push(Object.keys(evidence.labels));
    assert.deepEqual(evidence.transcript.map((turn: { text: string }) => turn.text), [
      "Give me a bird.", "# Binding DM ruling\nPersuasion succeeded.", "I will give you a bird.",
    ]);
    assert.ok(!JSON.stringify(evidence.transcript).includes("Old conversation"));
    assert.ok(!request.messages.some(message => message.content?.includes("As part of a review:")));
    const names = request.tools!.map(tool => tool.function.name);
    if (labelSets.length === 1) {
      assert.deepEqual(names, ["set_activity"]);
      assert.ok(request.messages.some(message => message.content?.includes("activate=false")));
    } else {
      assert.ok(!names.includes("set_activity") && !names.includes("set_wait") && !names.includes("clear_activity"));
      assert.ok(request.messages.some(message => message.content?.startsWith("Review only")));
    }
    return { role: "assistant", content: "No changes needed." };
  };
  await runConversation({ ...request, messages: [{ role: "user", content: "Old conversation" },
    { role: "assistant", content: "Old reply" }, ...request.messages] }, f.runtime);
  await f.reviews.drain();
  assert.deepEqual(categories, ["activity", "improvised_detail", "plot_progress", "other_world_update",
    "conversational_exchange", "relationship_or_knowledge_change"]);
  assert.deepEqual(labelSets, [["immediate_commitment", "deferred_commitment", "general_commitment", "immediate_feasibility"],
    ...categories.slice(1).map(category => [category])]);
});

test("unflagged turns skip reviews and discretion alone schedules only the activity review", async () => {
  for (const discretion of [false, true]) {
    const f = fixture("background"); let calls = 0;
    const decisions = f.runtime.services.ai.decisions;
    f.runtime.services.ai.decisions = async (state, questions, signal, purpose) => purpose === "conversation_attention"
      ? { immediate_commitment: choice("not_flagged"), immediate_feasibility: choice(discretion ? "gms_discretion" : "not_applicable") }
      : decisions(state, questions, signal, purpose);
    f.runtime.services.ai.responses = async request => {
      calls++;
      assert.deepEqual(request.tools?.map(tool => tool.function.name), ["set_activity"]);
      return { role: "assistant", content: "No supported activity." };
    };
    await runConversation(request, f.runtime);
    await f.reviews.drain();
    assert.equal(calls, discretion ? 1 : 0);
  }
});
