import { setupAgent } from "../packages/conversation/src/agent-setup.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../packages/contracts/src/index.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentReviewStrategy } from "../packages/conversation/src/document-review.js";
import { documentResolutionStrategy } from "../packages/conversation/src/document-resolution.js";
import { runConversationReview } from "../packages/conversation/src/review.js";
import { runResolution } from "../packages/conversation/src/resolution.js";
import { jevActionStrategy } from "../packages/conversation/src/action.js";
import type { AiService } from "../packages/conversation/src/services.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { planWorldAction } from "../apps/web/src/world-action.js";
import { loadPlayableWorld, assignActivity } from "./fixtures.js";

const entry = (id: string) => `Scenarios/Test/Characters/${id}/character.md`;
function fixture() {
  const notes = new Map([["Scenarios/Test/index.md", "Index"], ["Scenarios/Test/scenario.md", ["rowan", "corvin"].map(id => `[[${entry(id)}]]`).join("\n")], ["player.md", "Envoy"]]);
  for (const id of ["rowan", "corvin"]) {
    const access = `---\nvisibility: private\nreaders: ['character:${id}']\nsummary: ${id}'s task background.\n---\n`;
    notes.set(entry(id), access + `[[Cast/Test/${id}/private.md]] [[${id}-detail.md]]`);
    notes.set(`Cast/Test/${id}/private.md`, access + `${id} identity`);
    notes.set(`${id}-detail.md`, access + `[[${id}-nested.md]]`);
    notes.set(`${id}-nested.md`, access + `${id.toUpperCase()}_DEEP_KNOWLEDGE [[${entry(id)}]]`);
  }
  notes.set("gm.md", "---\nvisibility: gm\n---\nGM_SECRET");
  const map = loadPlayableWorld().simulation!.map!;
  map.actors.find(actor => actor.characterId === "rowan")!.position = { ...map.actors.find(actor => actor.characterId === "player")!.position! };
  const world = worldState(map, notes, "Test", "player.md");
  for (const id of ["rowan", "corvin"]) assignActivity(world, id, "Go to the hall");
  return world;
}
const review = { role: "assistant" as const, content: "Reviewed." };
function model(seen: string[]): AiService {
  return {
    decisions: async (state, questions, _signal, purpose, info) => {
      const text = JSON.stringify(state);
      assert.doesNotMatch(text, /GM_SECRET/);
      if (purpose === "prog_disc") {
        assert.doesNotMatch(text, info?.characterId === "corvin" ? /ROWAN_DEEP_KNOWLEDGE/ : /CORVIN_DEEP_KNOWLEDGE/);
        return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id, probabilities: { [id]: 1 } }]));
      }
      assert.match(text, /ROWAN_DEEP_KNOWLEDGE/);
      seen.push(questions.next ? "plan" : "attention");
      const key = questions.next ? "next" : "reaction", choice = key === "next" ? "wait" : "process";
      return { [key]: { choice, probabilities: {} } };
    },
    responses: async (request, _signal, info) => {
      const text = JSON.stringify(request), id = info?.characterId ?? "rowan";
      assert.match(text, new RegExp(`${id.toUpperCase()}_DEEP_KNOWLEDGE`));
      assert.doesNotMatch(text, id === "corvin" ? /ROWAN_DEEP_KNOWLEDGE|GM_SECRET/ : /CORVIN_DEEP_KNOWLEDGE|GM_SECRET/);
      seen.push(request.tools?.some(tool => tool.function.name === "set_activity") ? `review:${id}` : `speech:${id}`);
      return request.tools?.some(tool => tool.function.name === "set_activity") ? review : { role: "assistant", content: "Hello." };
    },
  };
}

test("planning, reviews, events and both NPC speakers retrieve nested knowledge independently", async () => {
  const world = fixture(), documents = createScenarioServices(world), seen: string[] = [], setups: string[] = [];
  const runtime = new ConversationRuntime({ services: { ...documents, lore: documentLoreService(documents.scenario), ai: model(seen), map: new WorldHost(world).map },
    strategies: { setup: { prepare: async (context, signal, services) => {
      setups.push(`${context.agent}:${context.characterId}`);
      return setupAgent(context, signal, services);
    } }, review: documentReviewStrategy, resolution: documentResolutionStrategy, action: jevActionStrategy } });
  await planWorldAction("rowan", runtime);
  await runConversationReview({ characterId: "rowan", participants: ["rowan", "player"],
    transcript: [create(TranscriptMessageSchema, { text: "Remember the plan." })] }, runtime);
  await runResolution({ kind: "world_event", characterId: "rowan", eventId: "event", perception: "Indistinct voices." }, runtime);
  await runResolution({ kind: "task_outcome", characterId: "rowan", goal: "Go to the hall", actions: [], result: { reason: "wait", detail: "Blocked" }, observation: "Hall" }, runtime);
  await runResolution({ kind: "npc_exchange", characterId: "rowan", targetId: "corvin", goal: "Discuss the plan" }, runtime);
  assert.deepEqual(seen, ["plan", "review:rowan", "attention", "review:rowan", "review:rowan", "speech:rowan", "speech:corvin", "review:rowan", "review:corvin"]);
  assert.deepEqual(setups, ["planner:rowan", "game_master:rowan", "attention:rowan", "game_master:rowan", "game_master:rowan",
    "exchange:rowan", "exchange:corvin", "game_master:rowan", "game_master:corvin"]);
});

test("NPC opening lines retrieve knowledge in the same traced turn as their speech", async () => {
  const seen: string[] = [], game = new WorldGameRuntime(fixture(), "", undefined, undefined, undefined, { services: { ai: model(seen) } });
  const action = game.map.observe("rowan").actions.find(action => action.id === "talk_player")!;
  assert.ok(action);
  await game.overrideActiveObjective("rowan", { currentGoal: "Discuss the plan" });
  await game.initiatePlayerConversation("rowan", action.id, game.world().simulation!.map!.revision, "Discuss the plan", new AbortController().signal);
  assert.deepEqual(seen, ["speech:rowan"]);
  const calls = Object.values(game.transcriptRuns()).flatMap(run => run.calls);
  assert.deepEqual(calls.map(call => call.kind), ["prog_disc", "prog_disc", "dialogue"]);
  assert.equal(new Set(calls.map(call => call.turnId)).size, 1);
});

test("disclosure failure prevents review writes and model responses", async () => {
  const documents = createScenarioServices(fixture()), before = documents.scenario.read();
  const runtime = new ConversationRuntime({ services: { ...documents, lore: documentLoreService(documents.scenario), ai: {
    decisions: async () => { throw new Error("Retrieval failed"); },
    responses: async () => { assert.fail("Must not respond with incomplete knowledge"); },
  } }, strategies: { review: documentReviewStrategy } });
  await assert.rejects(runConversationReview({ characterId: "rowan", participants: ["rowan"], transcript: [] }, runtime), /Retrieval failed/);
  assert.deepEqual(documents.scenario.read(), before);
});

test("injected lore feeds progressive disclosure for both review and planning", async () => {
  const documents = createScenarioServices(fixture()), scopes: string[] = [], seen: string[] = [];
  const runtime = new ConversationRuntime({ services: { ...documents, map: new WorldHost(documents.scenario.read()).map,
    scenario: { ...documents.scenario, getDocument: async () => assert.fail("Must use the injected lore source") },
    lore: { forCharacter: async id => {
      scopes.push(id);
      return { initial: [{ path: "injected", markdown: "INJECTED_ROOT" }],
        links: () => [{ from: "injected", path: "detail" }],
        open: async link => ({ path: link.path, markdown: "INJECTED_DETAIL" }) };
    } },
    ai: { decisions: async (state, questions, _signal, purpose) => {
      if (purpose === "prog_disc") return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id, probabilities: { [id]: 1 } }]));
      assert.match(String(state), /INJECTED_DETAIL/); seen.push("plan");
      return { next: { choice: "wait", probabilities: {} } };
    }, responses: async request => {
      assert.match(JSON.stringify(request), /INJECTED_DETAIL/); seen.push("review"); return review;
    } },
  }, strategies: { review: documentReviewStrategy, action: jevActionStrategy } });
  await planWorldAction("rowan", runtime);
  await runConversationReview({ characterId: "rowan", participants: ["rowan"], transcript: [] }, runtime);
  assert.deepEqual(scopes, ["rowan", "rowan"]);
  assert.deepEqual(seen, ["plan", "review"]);
});
