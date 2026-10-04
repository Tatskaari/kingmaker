import assert from "node:assert/strict";
import test from "node:test";
import { ConversationReviews, liveConversationStrategy } from "../packages/conversation/src/live-conversation-strategy.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runConversation } from "../packages/conversation/src/phases.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import type { OpenRouterMessage } from "../packages/providers/src/openrouter.js";

const choice = (value: string) => ({ choice: value, probabilities: { [value]: 1 } });
function fixture(mode: "background" | "approve" | "deny" | "limit" | "error") {
  const backing = createScenarioServices(loadPlayableWorld());
  const before = backing.scenario.snapshot();
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
      return mode === "deny" && drafts.length > 1 ? { immediate_commitment: choice("not_flagged") }
        : { immediate_commitment: choice("flagged"), immediate_feasibility: choice(mode === "background" ? "possible" : "gms_discretion") };
    }, responses: async request => {
      if (request.response_format) return { role: "assistant", content: JSON.stringify({ allowed: mode === "approve", reason: "This bird belongs to another guest. Offer something else." }) };
      if (mode === "background") await gate;
      return { role: "assistant", content: null, tool_calls: [{ id: "review", type: "function", function: {
        name: "commit_review", arguments: JSON.stringify({ summary: "Recorded", newNotes: ["Promised the player a gift."] }),
      } }] };
    } },
  }, strategies: { conversation: liveConversationStrategy({ characterId: "corvin", reviews, maxDrafts: 2 }) } });
  return { runtime, reviews, before, backing, drafts, events, release };
}
const request = { model: "test", messages: [{ role: "user" as const, content: "Give me a bird." },
  { role: "system" as const, content: "# Binding DM ruling\nPersuasion succeeded." }] };

test("ordinary flags release a response while GM review remains pending", async () => {
  const f = fixture("background");
  const reply = await runConversation(request, f.runtime);
  assert.equal(reply.content, "I will give you a bird.");
  assert.deepEqual(f.backing.scenario.snapshot(), f.before);
  assert.ok(!f.events.includes("live-review"));
  f.release(); await f.reviews.drain();
  assert.ok(f.events.includes("live-review"));
  assert.notDeepEqual(f.backing.scenario.snapshot(), f.before);
});

test("GM discretion commits its approved consequences before returning", async () => {
  const f = fixture("approve");
  await runConversation(request, f.runtime);
  assert.notDeepEqual(f.backing.scenario.snapshot(), f.before);
  assert.ok(f.events.indexOf("live-review") < f.events.indexOf("live-accepted"));
  const after = f.backing.scenario.snapshot();
  await f.reviews.drain();
  assert.deepEqual(f.backing.scenario.snapshot(), after);
});

test("refusal regenerates with a system correction, preserves the dice ruling and writes nothing", async () => {
  const f = fixture("deny");
  const reply = await runConversation(request, f.runtime);
  assert.equal(reply.content, "I cannot give that away.");
  assert.equal(f.drafts.length, 2);
  assert.match(f.drafts[1]![1]!.content!, /This bird belongs/);
  assert.equal(f.drafts[1]![1]!.role, "system");
  assert.deepEqual(f.drafts[1]!.at(-1), request.messages[1]);
  assert.ok(!f.drafts[1]!.some(message => message.role === "assistant"));
  await f.reviews.drain();
  assert.deepEqual(f.backing.scenario.snapshot(), f.before);
});

test("repeated refusals and classifier errors fail closed without world effects", async () => {
  for (const mode of ["limit", "error"] as const) {
    const f = fixture(mode);
    await assert.rejects(runConversation(request, f.runtime), /refused every draft|Jev unavailable/);
    assert.deepEqual(f.backing.scenario.snapshot(), f.before);
    assert.ok(!f.events.includes("live-accepted"));
  }
});

test("background failures surface on drain and prevent later jobs from overtaking them", async () => {
  const reviews = new ConversationReviews();
  reviews.enqueue(async () => { throw new Error("Review failed"); });
  reviews.enqueue(async () => { assert.fail("Must not overtake failed review"); });
  await assert.rejects(reviews.drain(), /Review failed/);
});
