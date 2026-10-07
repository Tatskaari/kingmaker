import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { setupAgent } from "../packages/conversation/src/agent-setup.js";
import { prepareConversation } from "../packages/conversation/src/conversation.js";
import { runGameMaster } from "../packages/conversation/src/game-master.js";
import { loadPlayableWorld } from "./fixtures.js";

const signal = () => new AbortController().signal;
test("character setup can replace the prompt using injected services without changing caller evidence", async () => {
  const runtime = new ConversationRuntime({ services: { scenario: { info: () => ({ scenario: "scenario.md", scenarioIndex: "index.md", characters: [] }) } },
    strategies: { setup: { prepare: async (context, cancellation, services) => {
      assert.equal(context.agent, "character");
      assert.equal(context.characterId, "corvin");
      cancellation.throwIfAborted();
      return [{ role: "system", content: services.scenario.info().scenario }, ...context.messages];
    } } } });
  const input = { world: loadPlayableWorld(), characterId: "corvin", sources: [], transcript: [], message: "Hello" };
  const before = structuredClone(input);
  const request = await prepareConversation(input, runtime.services);
  assert.equal(request.messages[0]!.content, "scenario.md");
  assert.match(request.messages[1]!.content!, /Before you stands Visiting Envoy/);
  assert.deepEqual(request.messages.at(-1), { role: "user", content: "Hello" });
  assert.deepEqual(input, before);
});

test("default setup resolves character lore and completes disclosure through services", async () => {
  const runtime = new ConversationRuntime({ services: { lore: { forCharacter: async id => {
    assert.equal(id, "corvin");
    return { initial: [{ path: "private.md", markdown: "Private voice" }], links: () => [], open: async () => { throw new Error("unused"); } };
  } }, disclosure: { disclose: async (_lore, messages) => {
    assert.match(messages[0]!.content!, /Private voice/);
    return [{ role: "system", content: "Opened context" }];
  } } } });
  const messages = await runtime.services.agents.prepare({ agent: "exchange", characterId: "corvin", messages: [], disclose: true }, signal());
  assert.match(messages[1]!.content!, /Opened context/);
  assert.match(messages[2]!.content!, /Speak only/);
});

test("GM setup runs once before tool execution and can delegate to default policy", async () => {
  let setups = 0;
  const runtime = new ConversationRuntime({ strategies: { setup: { prepare: async (...args) => {
    setups++;
    const messages = await setupAgent(...args);
    return [{ role: "system", content: "Custom GM" }, ...messages];
  } } }, services: { ai: { responses: async request => {
    assert.equal(request.messages[0]!.content, "Custom GM");
    assert.match(request.messages[1]!.content!, /You are a game master/);
    return { role: "assistant", content: "A ruling" };
  } } } });
  await runGameMaster({ model: "test", messages: [] }, runtime.services, signal());
  assert.equal(setups, 1);
});

test("setup failures and cancellation prevent model execution", async () => {
  let calls = 0;
  const controller = new AbortController();
  const runtime = new ConversationRuntime({ strategies: { setup: { prepare: async () => { controller.abort(); return []; } } },
    services: { ai: { responses: async () => { calls++; return { role: "assistant", content: "Unexpected" }; } } } });
  await assert.rejects(runGameMaster({ model: "test", messages: [] }, runtime.services, controller.signal), /abort/i);
  runtime.strategies.setup.prepare = async () => { throw new Error("Setup failed"); };
  await assert.rejects(runGameMaster({ model: "test", messages: [] }, runtime.services, signal()), /Setup failed/);
  assert.equal(calls, 0);
});
