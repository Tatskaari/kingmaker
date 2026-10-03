import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { beginStranger, strangerTurn } from "../apps/web/src/stranger-interview.js";
import { strangerOpening } from "../apps/web/src/introduction.js";
import { characterId } from "../packages/lore/src/character-id.js";
import { loadPlayableWorld } from "./fixtures.js";
import type { AiService } from "../packages/conversation/src/services.js";

export function creationWorld() {
  const world = loadPlayableWorld();
  delete world.docs[world.player!]; delete world.player;
  return world;
}
export function creationInput(world = creationWorld()) {
  const entries = world.characters.map(path => ({ characterId: characterId(path, world), description: "No prior acquaintance." }));
  return { name: "Alex", gender: "nonbinary", homeland: "Independent", embassyRole: "A visiting scholar", lore: "You quietly serve the Stranger.",
    currentGoal: "Explore court", relationships: entries, npcViews: entries,
    build: { classId: "rogue", abilityPriority: ["dexterity", "charisma", "intelligence", "constitution", "wisdom", "strength"], skills: ["persuasion", "deception", "insight", "stealth"] } };
}
export const ai = (responses: AiService["responses"]): AiService => ({ responses, decisions: async (_state, questions) => Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "skip", probabilities: { [id]: 0, skip: 1 } }])) });
const interviewAi = (responses: AiService["responses"]) => new ConversationRuntime({ services: { ai: ai(responses) } }).services;
test("v2 Stranger keeps the opening and prepares a detached editable draft from live cast IDs", async () => {
  const world = creationWorld(), { scenario } = createScenarioServices(world);
  const start = beginStranger(scenario.snapshot());
  assert.equal(start.history[0]!.content, strangerOpening);
  const next = await strangerTurn(start, "Ready", scenario, interviewAi(async request => {
    assert.match(JSON.stringify(request), /Peregrine|peregrine/);
    assert.doesNotMatch(JSON.stringify(request), /Private initial plot|requires Aldren to abdicate/);
    return { role: "assistant", content: null, tool_calls: [{ id: "draft", type: "function", function: { name: "create_player", arguments: JSON.stringify(creationInput(world)) } }] };
  }));
  assert.ok(next.draft);
  assert.equal(start.history.length, 1);
  assert.equal(scenario.info().player, undefined);
  assert.deepEqual(scenario.snapshot(), world);
});
test("v2 Stranger retries invalid relationships without another readiness question", async () => {
  const world = creationWorld(), { scenario } = createScenarioServices(world); let calls = 0;
  const next = await strangerTurn(beginStranger(scenario.snapshot()), "Ready", scenario, interviewAi(async request => {
    if (calls) assert.match(JSON.stringify(request.messages.at(-1)), /every court character/);
    const input = creationInput(world);
    if (!calls++) input.npcViews.pop();
    return { role: "assistant", content: null, tool_calls: [{ id: `draft${calls}`, type: "function", function: { name: "create_player", arguments: JSON.stringify(input) } }] };
  }));
  assert.equal(calls, 2); assert.ok(next.draft);
});
test("failed model turns preserve the original interview; suggestions do not select an answer", async () => {
  const { scenario } = createScenarioServices(creationWorld()), start = beginStranger(scenario.snapshot());
  await assert.rejects(strangerTurn(start, "Alex", scenario, interviewAi(async () => { throw new Error("offline"); })), /offline/);
  assert.equal(start.history.length, 1);
  const next = await strangerTurn(start, "Alex", scenario, interviewAi(async () => ({ role: "assistant", content: "How do you get your way?", tool_calls: [
    { id: "options", type: "function", function: { name: "offer_replies", arguments: JSON.stringify({ options: ["Charm", "Strength"], compelled: false }) } },
  ] })));
  assert.deepEqual(next.replies?.options, ["Charm", "Strength"]);
  assert.equal(next.history.filter(turn => turn.role === "user").length, 1);
});

import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { characterCreationWorld } from "../apps/web/src/playable-world.js";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { GamePhase, PlayerSetupSchema } from "../packages/contracts/src/index.js";
import { documentLore } from "../packages/conversation/src/document-lore.js";

test("creation resumes after reload; explicit save publishes reviewed identity, build and scoped impressions", async () => {
  const world = characterCreationWorld(loadPlayableWorld());
  const options = { services: { ai: ai(async () => ({ role: "assistant", content: null, tool_calls: [
    { id: "draft", type: "function", function: { name: "create_player", arguments: JSON.stringify(creationInput(world)) } },
  ] })) } };
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, options);
  assert.equal(runtime.view().phase, "player_creation");
  runtime.startIntroduction();
  const before = runtime.snapshot();
  runtime.restore(JSON.parse(JSON.stringify(before)));
  assert.equal((runtime.view().gmMessages as unknown[]).length, 1);
  await runtime.talkToGameMaster("Ready");
  assert.equal(runtime.view().phase, "character_review");
  assert.equal(runtime.world().player, undefined);
  const saved = runtime.snapshot();
  const restored = new WorldGameRuntime(world, "", JSON.parse(JSON.stringify(saved)), undefined, undefined, options);
  const draft = fromJson(PlayerSetupSchema, restored.view().playerDraft as never);
  draft.player!.name = "Alexandra"; draft.player!.sprite = 84;
  draft.player!.dnd!.hitPoints!.maximum = 50;
  draft.player!.dnd!.hitPoints!.current = 50;
  const positions = runtime.world().map!.actors;
  await restored.confirmPlayer(toJson(PlayerSetupSchema, draft));
  assert.equal(restored.view().phase, "conversations");
  assert.equal((restored.view().player as { name: string }).name, "Alexandra");
  assert.equal((restored.view().player as { sprite: number }).sprite, 84);
  assert.deepEqual(restored.world().map!.actors, positions);
  const player = restored.world().docs[restored.world().player!]!;
  assert.equal(player.characterProperties!.dnd!.hitPoints!.maximum, 50);
  assert.ok(player.characterProperties!.inventory?.items.length);
  const services = createScenarioServices(restored.world());
  const npcLore = await documentLore(services.scenario, "aldren");
  assert.doesNotMatch(JSON.stringify(npcLore.initial), /quietly serve the Stranger/);
  assert.match(JSON.stringify(npcLore.initial), /No prior acquaintance/);
  await assert.rejects(restored.confirmPlayer(toJson(PlayerSetupSchema, draft)), /awaiting review/);
  restored.resetWorld();
  assert.equal(restored.world().map!.phase, GamePhase.CONVERSATIONS);
  assert.equal(restored.world().player, "Players/player.md");
  restored.reset();
  assert.equal(restored.view().phase, "player_creation");
  assert.equal((restored.view().gmMessages as unknown[]).length, 0);
});
test("invalid review keeps the draft and world intact", async () => {
  const world = characterCreationWorld(loadPlayableWorld());
  const runtime = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: { ai: ai(async () => ({
    role: "assistant", content: null, tool_calls: [{ id: "draft", type: "function", function: { name: "create_player", arguments: JSON.stringify(creationInput(world)) } }],
  })) } });
  runtime.startIntroduction(); await runtime.talkToGameMaster("Ready");
  const draft = fromJson(PlayerSetupSchema, runtime.view().playerDraft as never), before = runtime.snapshot();
  draft.player!.relationships.pop();
  await assert.rejects(runtime.confirmPlayer(toJson(PlayerSetupSchema, draft)), /every court character/);
  assert.deepEqual(runtime.snapshot(), before);
});
