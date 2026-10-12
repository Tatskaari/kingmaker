import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { QuestTranscriptReviewer } from "../packages/conversation/src/quest-transcript-reviewer.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("quest transcript review can observe the character's world and available actions", async () => {
  const backing = createScenarioServices(loadPlayableWorld()), host = new WorldHost(backing.scenario.read());
  const reviewer = new QuestTranscriptReviewer();
  let summaries = 0, updates = 0;
  const runtime = new ConversationRuntime({ services: { ...backing, map: host.map, lore: documentLoreService(backing.scenario),
    ai: {
      decisions: async (_state, questions, _signal, purpose) => Object.fromEntries(Object.entries(questions).map(([id, question]) => {
        const selected = purpose === "quest_relevance" && question.instructions.includes('"id": "talk_to_aldren"') ? "update"
          : purpose === "quest_relevance" ? "unchanged" : "skip";
        return [id, { choice: selected, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0])) }];
      })),
      responses: async request => {
        if (!request.tools?.length) {
          summaries++;
          assert.equal(request.reasoning?.effort, "none");
          return { role: "assistant", content: "The player offered Aldren a new way to begin the cushion inquiry." };
        }
        updates++;
        const prompt = request.messages.map(message => message.content ?? "").join("\n");
        assert.match(prompt, /Call `observe_world`/);
        assert.ok(request.tools?.some(tool => tool.function.name === "observe_world"));
        return { role: "assistant", content: "The existing route already supports this development." };
      },
    },
  } });
  const context = { characterId: "aldren", participants: ["aldren", "player"], transcript: [
    create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: "PLOT: I can investigate another route." }),
    create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: "aldren", text: "Then begin with Holt." }),
  ] };
  await reviewer.review(context, new AbortController().signal, runtime.services);
  assert.equal(summaries, 1);
  assert.equal(updates, 1);
  assert.deepEqual(Object.keys(reviewer.snapshot()), ["talk_to_aldren"]);
});

test("quest relevance considers every unfinished story quest and includes their folder index", async () => {
  const world = loadPlayableWorld();
  assert.equal(world.quests.talk_to_aldren!.active, true);
  assert.equal(world.quests.assembly_programme!.active, false);
  const backing = createScenarioServices(world), host = new WorldHost(backing.scenario.read());
  let relevancePrompts: unknown[] = [];
  const runtime = new ConversationRuntime({ services: { ...backing, map: host.map, lore: documentLoreService(backing.scenario),
    ai: {
      decisions: async (_state, questions, _signal, purpose) => {
        if (purpose === "quest_relevance") relevancePrompts = Object.values(questions).map(question => question.instructions);
        return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, { choice: "unchanged",
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === "unchanged" ? 1 : 0])) }]));
      },
      responses: async () => assert.fail("No quest update should run"),
    },
  } });
  const context = { characterId: "aldren", participants: ["aldren", "player"], transcript: [
    create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: "PLOT: I want another route." }),
    create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: "aldren", text: "Let us consider it." }),
  ] };

  const labels = await new QuestTranscriptReviewer().classify(context, new AbortController().signal, runtime.services);

  assert.deepEqual(labels.candidates.map(candidate => candidate.id).sort(), ["assembly_programme", "talk_to_aldren"]);
  assert.equal(relevancePrompts.length, 2);
  for (const prompt of relevancePrompts) {
    assert.match(String(prompt), /unfinished quest/);
    assert.match(String(prompt), /Scenarios\/Centennial Assembly\/Quests\/index\.md/);
  }
});
