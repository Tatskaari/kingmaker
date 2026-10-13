import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { DocumentSchema } from "../packages/contracts/src/v2.js";
import { NarrativeReviewer, reviewNarrative, documentChangeSummary } from "../packages/conversation/src/narrative-reviewer.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";
import type { OpenRouterMessage } from "../packages/providers/src/openrouter.js";

test("narrative queue injects arrivals after tool results, without classification, and retains history", async () => {
  const backing = createScenarioServices(loadPlayableWorld()), host = new WorldHost(backing.scenario.read());
  const requests: OpenRouterMessage[][] = [], warnings: unknown[] = [];
  let reviewer: NarrativeReviewer;
  const services = new ConversationRuntime({ services: { ...backing, map: host.map, ai: {
    decisions: async () => { throw new Error("Narrative must not classify"); },
    responses: async request => {
      requests.push(structuredClone(request.messages));
      assert.equal(request.reasoning?.effort, "high");
      assert.ok(!request.tools?.some(tool => tool.function.name.startsWith("observe_")));
      if (requests.length === 1) {
        reviewer.enqueue([{ id: "npc-pair[0]", characterId: "bran", summary: "bran: I will help move the cart." }]);
        return { role: "assistant", content: "", tool_calls: [{ id: "read", type: "function", function: {
          name: "read_document", arguments: JSON.stringify({ path: backing.scenario.info().scenario }),
        } }] };
      }
      return { role: "assistant", content: "Reviewed the cited developments." };
    },
  } } }).services;
  reviewer = new NarrativeReviewer((history, take, signal) => reviewNarrative(history, take, services, signal), error => warnings.push(error));
  reviewer.enqueue([{ id: "player-chat[0]", characterId: "aldren", summary: "player: What about the cart?" }]);
  await reviewer.drain();
  assert.deepEqual(warnings, []);
  assert.equal(requests.length, 2);
  const second = requests[1]!, toolIndex = second.findIndex(message => message.tool_call_id === "read");
  assert.ok(toolIndex > 0);
  assert.match(second[toolIndex + 1]!.content!, /npc-pair\[0\].*bran: I will help move the cart/s);
  assert.match(second[toolIndex + 1]!.content!, /Actions for bran/);
  assert.match(JSON.stringify(requests[0]), /Quests\/.*\.md/);
  reviewer.enqueue([{ id: "document/1", summary: "Narrative agent: Edited Conversations/bran.md" }], false);
  await reviewer.drain();
  assert.equal(requests.length, 2, "own writes do not wake an idle worker");
  reviewer.enqueue([{ id: "player-chat[1]", summary: "player: Let's do that." }]);
  await reviewer.drain();
  assert.equal(requests.length, 3);
  assert.ok(requests[2]!.some(message => message.content === "Reviewed the cited developments."));
  assert.match(requests[2]!.at(-1)!.content!, /document\/1.*player-chat\[1\]/s);
  reviewer.cancel();
});

test("narrative cancellation stops late events and failures allow a later batch", async () => {
  let calls = 0, failures = 0;
  const seen: string[] = [];
  const reviewer = new NarrativeReviewer(async (_history, take) => {
    seen.push(...take().map(event => event.id));
    if (++calls === 1) throw new Error("Provider unavailable");
  }, () => { failures++; });
  reviewer.enqueue([{ id: "chat[0]", summary: "Hello" }]);
  await reviewer.drain();
  reviewer.enqueue([{ id: "chat[1]", summary: "Still here" }]);
  await reviewer.drain();
  assert.equal(failures, 1);
  assert.deepEqual(seen, ["chat[0]", "chat[1]"]);
  reviewer.cancel();
  reviewer.enqueue([{ id: "chat[2]", summary: "Too late" }]);
  await reviewer.drain();
  assert.equal(calls, 2);
});

test("document events summarize edits, omit unchanged prose and bound large diffs", () => {
  const before = create(DocumentSchema, { body: "Unchanged\nOld route\n" });
  const after = create(DocumentSchema, { body: "Unchanged\nNew route\n" });
  const summary = documentChangeSummary("quest.md", before, after);
  assert.match(summary, /- Old route\n\+ New route/);
  assert.doesNotMatch(summary, /Unchanged/);
  assert.equal(documentChangeSummary("quest.md", before, before), "");
  assert.match(documentChangeSummary("quest.md", before, undefined), /Deleted/);
  assert.ok(documentChangeSummary("large.md", undefined, create(DocumentSchema, { body: "a".repeat(10_000) })).length < 1800);
});
