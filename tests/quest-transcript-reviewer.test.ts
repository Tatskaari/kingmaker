import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { QuestTranscriptReviewer } from "../packages/evals/src/quest-transcript-reviewer.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { documentLoreService } from "../packages/conversation/src/document-lore.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("quest transcript review sees the whole map and the character's available actions", async () => {
  const backing = createScenarioServices(loadPlayableWorld()), host = new WorldHost(backing.scenario.read());
  const reviewer = new QuestTranscriptReviewer();
  let summaries = 0, updates = 0;
  const runtime = new ConversationRuntime({ services: { ...backing, map: host.map, lore: documentLoreService(backing.scenario),
    ai: {
      decisions: async (_state, questions, _signal, purpose) => Object.fromEntries(Object.entries(questions).map(([id, question]) => {
        const selected = purpose === "quest_relevance" ? "update" : "skip";
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
        assert.match(prompt, /## Whole physical map/);
        assert.match(prompt, /great_hall/);
        assert.match(prompt, /## Actions currently available to the reviewed character/);
        assert.match(prompt, /talk_/);
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
  assert.deepEqual(Object.keys(reviewer.snapshot(runtime.services)), ["talk_to_aldren"]);
});
