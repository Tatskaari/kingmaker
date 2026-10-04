import { setupAgent } from "../packages/conversation/src/agent-setup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { beginStranger, strangerTurn } from "../apps/web/src/stranger-interview.js";
import { strangerLore } from "../apps/web/src/stranger-lore.js";
import { strangerPrompt } from "../apps/web/src/stranger-prompt.js";

function fixture() {
  return createScenarioServices(worldState(create(MapSchema), new Map([
    ["Scenarios/Test/scenario.md", "Scenario sentinel, not initially loaded."],
    ["Scenarios/Test/index.md", "Index"],
    ["Scenarios/Test/stranger.md", '---\nsummary: Creation guide\nvisibility: gm\naffiliations: [Independent, Test Guild]\nopening: What is your name, traveller?\n---\nYou introduce the player to this world. [[World/detail]] [[World/skipped]]'],
    ["World/detail.md", '---\nsummary: Relevant institutions\nvisibility: gm\n---\nDETAIL_SENTINEL [[World/private]]'],
    ["World/private.md", '---\nsummary: Private history\nvisibility: private\nreaders: ["character:someone-else"]\n---\nPRIVATE_SENTINEL'],
    ["World/skipped.md", '---\nsummary: Unrelated topic\nvisibility: gm\n---\nSKIPPED_SENTINEL'],
    ["World/unlinked.md", "UNLINKED_SENTINEL"],
  ]), "Test"));
}

test("Stranger uses shared multi-round disclosure with GM access and summary previews", async () => {
  const { scenario } = fixture(); let rounds = 0, replies = 0;
  const services = new ConversationRuntime({ strategies: { setup: { prepare: async (context, signal, services) => {
    assert.equal(context.agent, "stranger");
    return [...await setupAgent(context, signal, services), { role: "system", content: "Custom interview guidance" }];
  } } }, services: { ai: {
    decisions: async (context, questions, _signal, purpose) => {
      assert.equal(purpose, "prog_disc"); rounds++;
      if (rounds === 1) {
        assert.doesNotMatch(String(context), /DETAIL_SENTINEL|PRIVATE_SENTINEL/);
        assert.match(JSON.stringify(questions), /Relevant institutions/);
      }
      return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
        const open = /World\/(detail|private)\.md/.test(JSON.stringify(question));
        return [id, { choice: open ? id : "skip", probabilities: { [id]: open ? .95 : 0, skip: open ? .05 : 1 } }];
      }));
    },
    responses: async request => {
      replies++;
      assert.equal(request.messages.at(-1)!.content, "Custom interview guidance");
      const content = JSON.stringify(request.messages);
      assert.match(content, /DETAIL_SENTINEL/); assert.match(content, /PRIVATE_SENTINEL/);
      assert.doesNotMatch(content, /SKIPPED_SENTINEL|UNLINKED_SENTINEL|Scenario sentinel/);
      assert.deepEqual((request.tools![1]!.function.parameters.properties as any).homeland.enum, ["Independent", "Test Guild"]);
      return { role: "assistant", content: "What are you good at?" };
    },
  } } }).services;
  const initial = beginStranger(scenario.snapshot());
  assert.equal(initial.history[0]!.content, "What is your name, traveller?");
  const next = await strangerTurn(initial, "Tell me about the institutions", scenario, services);
  assert.equal(rounds, 3); assert.equal(replies, 1);
  assert.equal(initial.history.length, 1);
  assert.equal(next.history.length, 3);
  assert.doesNotMatch(JSON.stringify(next), /DETAIL_SENTINEL|PRIVATE_SENTINEL/);
});

test("injected disclosure is honoured and its failure prevents speaking or draft mutation", async () => {
  const { scenario } = fixture(), before = beginStranger(scenario.snapshot()); let calls = 0;
  const services = new ConversationRuntime({ services: {
    disclosure: { disclose: async (lore, context, _signal, options) => {
      calls++;
      assert.equal(lore.initial.length, 1);
      assert.equal(lore.initial[0]!.path, "Scenarios/Test/stranger.md");
      assert.equal(options?.characterId, "gm");
      assert.match(JSON.stringify(context), /Latest player question/);
      throw new Error("Disclosure unavailable");
    } },
    ai: { responses: async () => { assert.fail("Must not speak after failed disclosure"); } },
  } }).services;
  await assert.rejects(strangerTurn(before, "Latest player question", scenario, services), /Disclosure unavailable/);
  assert.equal(calls, 1); assert.equal(before.history.length, 1); assert.equal(before.draft, undefined);
});

test("Stranger reads saved document edits and generic instructions contain no setting identity", async () => {
  const services = fixture();
  const original = await services.docs.read("Scenarios/Test/stranger.md");
  await services.docs.replace(original.path, original.sha, "introduce", "EDIT_SENTINEL introduce");
  const lore = await strangerLore(services.scenario);
  assert.match(lore.initial[0]!.markdown, /EDIT_SENTINEL/);
  assert.doesNotMatch(strangerPrompt, /Laughing Stranger|Caerwyn|Nine Furrows|Kläggenheim|Saltmere|crossroads|trickster/);
});
