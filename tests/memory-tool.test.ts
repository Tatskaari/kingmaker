import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "../scripts/lib/playable-world.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { memoryIndexPath } from "../packages/lore/src/memories.js";
import { documentLore } from "../packages/conversation/src/document-lore.js";
import { memoryResponse } from "../packages/conversation/src/memory-tool.js";
import { arrestResponse } from "../packages/conversation/src/conversation-actions.js";
import type { OpenRouterMessage } from "../packages/providers/src/openrouter.js";

const memory = { title: "A promised visit", context: "While speaking to the visitor in the hall.", content: "The visitor promised to return tomorrow." };
const call = (input: unknown = memory): OpenRouterMessage => ({ role: "assistant", content: null,
  tool_calls: [{ id: "memory-1", type: "function", function: { name: "save_memory", arguments: JSON.stringify(input) } }] });
const fixture = () => ({ ...createScenarioServices(loadPlayableWorld()), debug: { record: () => {} } });

test("conversation memory tool saves and resumes a plain reply, with malformed arguments recoverable", async () => {
  const services = fixture(); let calls = 0;
  const respond = memoryResponse(async request => {
    assert.ok(request.tools?.some(tool => tool.function.name === "save_memory"));
    if (++calls === 1) return call({ ...memory, characterId: "aldren" });
    if (calls === 2) { assert.match(request.messages.at(-1)!.content!, /Unexpected memory argument/); return call(); }
    assert.match(request.messages.at(-1)!.content!, /"ok":true/);
    return { role: "assistant", content: "Until tomorrow." };
  }, services, "corvin");
  assert.equal((await respond({ model: "test", messages: [] })).content, "Until tomorrow.");
  const lore = await documentLore(services.scenario, "corvin");
  assert.ok(lore.links(lore.initial).some(link => link.summary?.includes(memory.title)));
  const other = await documentLore(services.scenario, "aldren");
  assert.ok(!other.links(other.initial).some(link => link.summary?.includes(memory.title)));
});

test("cancellation before executing a returned memory call saves nothing", async () => {
  const services = fixture(), controller = new AbortController();
  const count = Object.keys(services.scenario.read().docs).length;
  const respond = memoryResponse(async () => { controller.abort(); return call(); }, services, "corvin");
  await assert.rejects(respond({ model: "test", messages: [] }, controller.signal), /abort/i);
  assert.equal(Object.keys(services.scenario.read().docs).length, count);
});

test("memory tool composes with arrest and retains the tool result exchange", async () => {
  const services = fixture(); let calls = 0, challenged = false;
  const respond = arrestResponse(memoryResponse(async request => {
    if (++calls === 1) return call();
    if (calls === 2) {
      assert.match(request.messages.at(-1)!.content!, /"ok":true/);
      return { role: "assistant", content: null, tool_calls: [{ id: "arrest-1", type: "function", function: { name: "arrest", arguments: "{}" } }] };
    }
    assert.ok(request.messages.some(message => message.tool_call_id === "arrest-1"));
    return { role: "assistant", content: "Explain yourself." };
  }, services, "corvin"), () => assert.fail("No arrest before defense"), { outcome: () => "unheard", challenge: () => { challenged = true; } });
  assert.equal((await respond({ model: "test", messages: [] })).content, "Explain yourself.");
  assert.equal(challenged, true);
});


test("game conversation exposes save_memory and reloads its private index on the next turn", async () => {
  let calls = 0;
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal) } },
    services: { ai: { responses: async request => {
      assert.ok(request.tools?.some(tool => tool.function.name === "save_memory"));
      if (++calls === 1) return call();
      if (calls === 3) assert.match(JSON.stringify(request.messages), /A promised visit/);
      return { role: "assistant", content: "Until tomorrow." };
    } } },
  });
  await runtime.checkedTalkToCharacter("corvin", "I will return tomorrow.");
  const entry = runtime.world().simulation!.runtimeCharacters.corvin!.document;
  assert.equal(runtime.world().docs[memoryIndexPath(entry)]!.links.length, 1);
  await runtime.checkedTalkToCharacter("corvin", "What did I promise?");
  assert.equal(calls, 3);
});
