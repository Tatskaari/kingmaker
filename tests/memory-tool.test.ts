import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "../scripts/lib/playable-world.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { memoryIndexPath } from "../packages/lore/src/memories.js";
import { documentLore } from "../packages/conversation/src/document-lore.js";
import { GameMasterTools } from "../packages/conversation/src/gm-tools.js";
import { runGameMaster } from "../packages/conversation/src/game-master.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import type { OpenRouterMessage } from "../packages/providers/src/openrouter.js";

const memory = { title: "A promised visit", context: "While speaking to the visitor in the hall.", content: "The visitor promised to return tomorrow." };
const call = (input: unknown = memory): OpenRouterMessage => ({ role: "assistant", content: null,
  tool_calls: [{ id: "memory-1", type: "function", function: { name: "save_memory", arguments: JSON.stringify(input) } }] });
const fixture = () => new ConversationRuntime({ services: createScenarioServices(loadPlayableWorld()) }).services;

test("DM rulings and reviews save separate memories using their current character", async () => {
  for (const review of [false, true]) {
    const services = fixture(); let calls = 0;
    services.ai.responses = async request => {
      assert.ok(request.tools?.some(tool => tool.function.name === "save_memory"));
      if (++calls === 1) return call({ ...memory, extra: "rejected" });
      if (calls === 2) { assert.match(request.messages.at(-1)!.content!, /Unexpected memory argument/); return call(); }
      assert.match(request.messages.at(-1)!.content!, /"ok":true/);
      return { role: "assistant", content: "Recorded." };
    };
    await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "corvin", review });
    const lore = await documentLore(services.scenario, "corvin"), index = lore.initial.at(-1)!;
    assert.ok(!index.markdown.includes(memory.content));
    const link = lore.links(lore.initial).find(link => link.summary?.includes(memory.title))!;
    const note = (await services.docs.read(link.path)).document;
    assert.equal(note.frontmatter!.title, memory.title);
    assert.equal(note.frontmatter!.context, memory.context);
    assert.equal(note.body.trim(), memory.content);
    const other = await documentLore(services.scenario, "aldren");
    await assert.rejects(other.open(link, new AbortController().signal), /No read access/);
  }
});

test("DM can target another character and rejects missing or invalid memory owners", async () => {
  const services = fixture(), gm = new GameMasterTools(services, "corvin");
  assert.match(JSON.stringify(await gm.call("save_memory", { ...memory, characterId: "aldren" })), /"ok":true/);
  const index = memoryIndexPath(services.scenario.read().simulation!.runtimeCharacters.aldren!.document);
  assert.equal((await services.docs.read(index)).document.links.length, 1);
  for (const characterId of [null, 42, "unknown"]) assert.match(JSON.stringify(await gm.call("save_memory", { ...memory, characterId })), /"ok":false/);
  assert.match(JSON.stringify(await new GameMasterTools(services).call("save_memory", memory)), /Supply characterId/);
});

test("cancellation before executing a DM memory call saves nothing", async () => {
  const services = fixture(), controller = new AbortController();
  const count = Object.keys(services.scenario.read().docs).length;
  services.ai.responses = async () => { controller.abort(); return call(); };
  await assert.rejects(runGameMaster({ model: "test", messages: [] }, services, controller.signal, { characterId: "corvin" }), /abort/i);
  assert.equal(Object.keys(services.scenario.read().docs).length, count);
});

test("game character responds once without tools or reasoning and receives DM memory indexes", async () => {
  let calls = 0;
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, {
    strategies: { conversation: { respond: (context, signal, services) => services.character.respond(context.request, signal) } },
    services: { ai: { responses: async request => {
      calls++;
      assert.equal(request.tools, undefined);
      assert.deepEqual(request.reasoning, { effort: "none" });
      assert.match(JSON.stringify(request.messages), /A promised visit/);
      return { role: "assistant", content: "Until tomorrow." };
    } } },
  });
  const services = new ConversationRuntime({ services: { docs: runtime.services.docs, scenario: runtime.services.scenario } }).services;
  await new GameMasterTools(services, "corvin").call("save_memory", memory);
  await runtime.checkedTalkToCharacter("corvin", "What did I promise?");
  assert.equal(calls, 1);
});

test("DM memory saves appear as one operation with two committed document diffs in Recent edits", async () => {
  const { ModelTranscripts } = await import("../apps/web/src/model-transcripts.js");
  // @ts-expect-error Browser renderer is JavaScript.
  const { documentExplorer } = await import("../apps/web/src/document-explorer.js");
  const services = fixture(), traces = new ModelTranscripts(""); let calls = 0;
  services.debug.documentUpdated = event => traces.documentUpdated(event);
  services.ai.responses = request => traces.record("conversation_review", "corvin", request, async () =>
    ++calls === 1 ? call() : { role: "assistant" as const, content: "Recorded." });
  const index = memoryIndexPath(services.scenario.read().simulation!.runtimeCharacters.corvin!.document);
  const before = await services.docs.read(index);
  await runGameMaster({ model: "test", messages: [] }, services, new AbortController().signal, { characterId: "corvin", review: true });
  const history = traces.documentWrites();
  assert.equal(history.length, 2);
  const indexWrite = history.find(write => write.path === index)!, memoryWrite = history.find(write => write.path !== index)!;
  assert.equal(indexWrite.beforeText, before.text);
  assert.equal(indexWrite.beforeSha, before.sha);
  assert.equal(indexWrite.afterText, (await services.docs.read(index)).text);
  assert.equal(memoryWrite.beforeText, "");
  assert.equal(memoryWrite.afterText, (await services.docs.read(memoryWrite.path)).text);
  const html = documentExplorer({ docs: services.scenario.read().docs, history });
  assert.match(html, /save_memory/);
  assert.match(html, /0 replaces, 1 add, 0 removals/);
  assert.match(html, /2 documents/);
  assert.equal((html.match(/class="doc-edit-group"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="Document changes"/g) ?? []).length, 2);
  assert.match(html, /doc-diff-add/);
  assert.match(html, /title: A promised visit/);
  assert.match(html, /View transcript/);
});
