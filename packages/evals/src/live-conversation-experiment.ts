import { clone, create } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { TranscriptMessageSchema, TranscriptRole } from "../../contracts/src/index.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { ConversationRuntime } from "../../conversation/src/runtime.js";
import { prepareConversation } from "../../conversation/src/conversation.js";
import { attentionResponseStrategy } from "../../conversation/src/conversation-strategy.js";
import { runConversation, type ConversationStrategy } from "../../conversation/src/phases.js";
import { documentLoreService } from "../../conversation/src/document-lore.js";
import type { AiService } from "../../conversation/src/services.js";
import { createScenarioServices } from "../../lore/src/services.js";
import { createReviewExperiment, documentChanges, type ReviewCase } from "./review-experiment.js";
import { giftInventoryScore } from "./peregrine-gift-case.js";
import type { Experiment, RuntimeConfig } from "./experiment.js";

/** Freeze only the original draft and resolved dice; inspect effects before conversation end. */
export interface LiveConversationVariant {
  name: string;
  strategy(testCase: ReviewCase): { strategy: ConversationStrategy; drain(): Promise<void> };
}
export function createLiveConversationExperiment(testCase: ReviewCase, createAi: () => AiService,
  judge: Pick<AiService, "decisions">, variants: readonly LiveConversationVariant[] = []): Experiment {
  const review = createReviewExperiment(testCase, [], createAi, judge);
  const config = (variant?: LiveConversationVariant): RuntimeConfig => ({ name: variant?.name ?? "game", configure() {
    const backing = createScenarioServices(clone(WorldStateSchema, testCase.loadWorld([])));
    const selected = variant?.strategy(testCase);
    let drafts: OpenRouterMessage[] = [];
    return { services: { docs: () => backing.docs, scenario: () => backing.scenario, ai: () => createAi(),
      lore: services => documentLoreService(services.scenario), debug: () => ({ record: () => {} }),
      character: services => ({ respond: async (request, signal) => {
        const fixed = drafts.shift();
        // Only replacement drafts use the live character model.
        return fixed ?? services.ai.responses(request, signal, { purpose: "dialogue" });
      } }),
    }, strategies: { conversation: { respond: async (context, signal, services) => {
      // Replay known history and binding rulings, without inventing new dice results.
      const accepted = [] as typeof testCase.transcript[number][];
      for (const turn of testCase.transcript) {
        if (turn.role !== TranscriptRole.CHARACTER) { accepted.push(turn); continue; }
        drafts = [{ role: "assistant", content: turn.text }];
        const playerIndex = accepted.findLastIndex(item => item.role === TranscriptRole.PLAYER);
        if (playerIndex < 0) throw new Error("Replay needs a player turn");
        const lore = await services.lore.forCharacter(testCase.characterId, signal);
        const request = await prepareConversation({ snapshot: { world: services.scenario.snapshot() },
          characterId: testCase.characterId, sources: lore.initial, transcript: accepted.slice(0, playerIndex),
          message: accepted[playerIndex]!.text }, services, signal);
        request.messages = [...request.messages, ...accepted.slice(playerIndex + 1).map(item => ({ role: "system" as const, content: item.text }))];
        const baseline = attentionResponseStrategy(event => services.debug.record({ turn: playerIndex, pass: 1,
          source: "attention", stage: "classify", status: "completed", output: event }));
        const reply = await runConversation(request, new ConversationRuntime({ services,
          strategies: { conversation: selected?.strategy ?? baseline } }), signal);
        accepted.push(create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: testCase.characterId, text: reply.content ?? "" }));
        services.debug.record({ turn: playerIndex, pass: 1, source: "released", stage: "respond", status: "completed",
          output: { reply, world: services.scenario.snapshot() } });
        await selected?.drain();
      }
      services.debug.record({ turn: 0, pass: 1, source: "accepted-transcript", stage: "respond", status: "completed", output: accepted });
      return { role: "assistant", content: accepted.at(-1)?.text ?? "" };
    } } } };
  } });
  return { ...review, name: `live-${testCase.name}`, getBaseline: () => config(), getVariants: () => variants.map(config),
    rubric: [...review.rubric, { name: "live-effect", description: "The expected world effect exists without ending the conversation; gifts exist before the response is released." }],
    async run(runtime, signal) { await runConversation({ model: "replay", messages: [] }, runtime, signal); },
    async score(recording, context) {
      const result = await review.score(recording, context);
      const world = recording.finalState as WorldState | undefined;
      const releases = recording.getServiceRecord("debug").map(call => (call.args as [{ source?: string; output?: { world?: WorldState } }])[0])
        .filter(event => event?.source === "released");
      const score = testCase.characterId === "peregrine"
        ? giftInventoryScore(releases.at(-1)?.output?.world).score
        : world && (documentChanges(recording).length > 0 || JSON.stringify(world.runtimeCharacters) !== JSON.stringify((recording.initialState as WorldState)?.runtimeCharacters)) ? 1 : 0;
      result.criteria["live-effect"] = { score: recording.error ? 0 : score,
        reason: testCase.characterId === "peregrine" ? "The gift must be in inventory at reply release." : "The NPC must have a recorded consequence before conversation end." };
      return result;
    },
  };
}
