import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { strangerOpening } from "../apps/web/src/introduction.js";

const load = () => fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
const build = { classId: "rogue", abilityPriority: ["dexterity", "charisma", "constitution", "intelligence", "wisdom", "strength"], skills: ["persuasion", "deception", "insight", "stealth"] };

test("the authored opening needs no identity or model call and survives reload without repeating", t => {
  t.mock.method(OpenRouterClient.prototype, "complete", () => { throw new Error("The opening must not call the model"); });
  const runtime = new BrowserGameRuntime(load(), "test");
  runtime.startIntroduction();
  runtime.startIntroduction();
  assert.equal(runtime.view().travellerIdentity, null);
  assert.deepEqual(runtime.view().gmMessages, [{ role: "assistant", text: strangerOpening }]);
  const restored = new BrowserGameRuntime(load(), "test", runtime.snapshot());
  restored.startIntroduction();
  assert.deepEqual(restored.view().gmMessages, runtime.view().gmMessages);
  restored.reset();
  assert.equal(restored.snapshot().strangerIntroduced, false);
  assert.deepEqual(restored.view().gmMessages, []);
});

test("conversation supplies identity, rejects missing details, and preserves review corrections in court", async t => {
  const scenario = load(), ids = scenario.characters.map(character => character.id);
  const generated = {
    name: "Maren", gender: "Non-binary", homeland: "Saltmere", embassyRole: "Accounts clerk",
    lore: "A devotee posing as a clerk.", currentGoal: "Expose the chancellor's hypocrisy.", build,
    relationships: ids.map(characterId => ({ characterId, description: "I have not met them." })),
    npcViews: ids.map(characterId => ({ characterId, description: "A visiting clerk." })),
  };
  let attempt = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    assert.ok(request.messages.some((item: any) => item.role === "assistant" && item.content === strangerOpening));
    const tool = request.tools.find((item: any) => item.function.name === "create_player").function;
    assert.ok(tool.parameters.required.includes("gender"));
    assert.deepEqual(tool.parameters.properties.homeland.enum, ["Ironmark", "Greenweald", "Saltmere"]);
    if (attempt++ === 1) {
      assert.match(request.messages.at(-1).content, /gender/);
      return { role: "assistant", content: "How would you describe your gender?" };
    }
    return { role: "assistant", content: null, tool_calls: [{ id: `draft-${attempt}`, type: "function", function: {
      name: "create_player", arguments: JSON.stringify({ ...generated, ...(attempt === 1 ? { gender: "" } : {}) }),
    } }] };
  });
  const initial = new BrowserGameRuntime(scenario, "test");
  initial.startIntroduction();
  const runtime = new BrowserGameRuntime(scenario, "test", initial.snapshot());
  await runtime.talkToGameMaster("I want to embarrass the chancellor. Call me Maren, an accounts clerk with Saltmere.");
  assert.equal(runtime.view().phase, "player_creation");
  assert.equal(runtime.snapshot().playerDraft, null);
  assert.equal(runtime.snapshot().travellerIdentity, undefined);
  await runtime.talkToGameMaster("Non-binary. I'm ready to review.");
  assert.equal(runtime.view().phase, "character_review");
  assert.equal(runtime.view().player, null);
  assert.deepEqual(runtime.snapshot().travellerIdentity, { name: "Maren", gender: "Non-binary", delegation: "Saltmere", sprite: 98 });
  const restored = new BrowserGameRuntime(scenario, "test", runtime.snapshot());
  const draft = structuredClone(restored.snapshot().playerDraft) as any;
  draft.player.name = "Seren";
  draft.player.gender = "Woman";
  draft.player.delegation = "Greenweald";
  draft.player.sprite = 87;
  restored.confirmPlayer(draft);
  assert.equal(restored.view().phase, "conversations");
  assert.deepEqual(restored.snapshot().travellerIdentity, { name: "Seren", gender: "Woman", delegation: "Greenweald", sprite: 87 });
  assert.throws(() => restored.startIntroduction(), /already complete/);
});

test("the sandbox interview keeps suggestions optional even if the model tries compulsion", async t => {
  let attempt = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    const tool = request.tools.find((item: any) => item.function.name === "offer_replies").function;
    assert.equal(tool.parameters.properties.compelled.const, false);
    if (attempt++) {
      assert.match(request.messages.at(-1).content, /free to invent/);
      return { role: "assistant", content: "We can invent something together." };
    }
    return { role: "assistant", content: null, tool_calls: [{ id: "options", type: "function", function: {
      name: "offer_replies", arguments: JSON.stringify({ options: ["I want power."], compelled: true }),
    } }] };
  });
  const runtime = new BrowserGameRuntime(load(), "test");
  runtime.startIntroduction();
  await runtime.talkToGameMaster("I'm not sure yet.");
  assert.equal(runtime.view().gmReplyOptions, null);
});
