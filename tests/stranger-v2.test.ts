import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { beginStranger, strangerTurn } from "../apps/web/src/stranger-interview.js";
import { strangerOpening } from "../apps/web/src/introduction.js";
import { characterId } from "../apps/web/src/world-projection.js";
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
export const ai = (responses: AiService["responses"]): AiService => ({ responses, decisions: async () => ({}) });
test("v2 Stranger keeps the opening and prepares a detached editable draft from live cast IDs", async () => {
  const world = creationWorld(), { scenario } = createScenarioServices(world);
  const start = beginStranger();
  assert.equal(start.history[0]!.content, strangerOpening);
  const next = await strangerTurn(start, "Ready", scenario, ai(async request => {
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
  const next = await strangerTurn(beginStranger(), "Ready", scenario, ai(async request => {
    if (calls) assert.match(JSON.stringify(request.messages.at(-1)), /every court character/);
    const input = creationInput(world);
    if (!calls++) input.npcViews.pop();
    return { role: "assistant", content: null, tool_calls: [{ id: `draft${calls}`, type: "function", function: { name: "create_player", arguments: JSON.stringify(input) } }] };
  }));
  assert.equal(calls, 2); assert.ok(next.draft);
});
test("failed model turns preserve the original interview; suggestions do not select an answer", async () => {
  const { scenario } = createScenarioServices(creationWorld()), start = beginStranger();
  await assert.rejects(strangerTurn(start, "Alex", scenario, ai(async () => { throw new Error("offline"); })), /offline/);
  assert.equal(start.history.length, 1);
  const next = await strangerTurn(start, "Alex", scenario, ai(async () => ({ role: "assistant", content: "How do you get your way?", tool_calls: [
    { id: "options", type: "function", function: { name: "offer_replies", arguments: JSON.stringify({ options: ["Charm", "Strength"], compelled: false }) } },
  ] })));
  assert.deepEqual(next.replies?.options, ["Charm", "Strength"]);
  assert.equal(next.history.filter(turn => turn.role === "user").length, 1);
});
