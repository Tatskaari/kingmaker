import { renderPrompt } from "../../prompts/src/index.js";
import { isDeepStrictEqual } from "node:util";
import type { WorldState } from "../../contracts/src/v2.js";
import type { ConversationReviewContext } from "../../conversation/src/review.js";
import { runConversationReview } from "../../conversation/src/review.js";
import { documentLoreService } from "../../conversation/src/document-lore.js";
import { replayConversation, type ReviewConversation, type ReviewConversationFactory } from "./review-conversation.js";
import { directConversationStrategy } from "../../conversation/src/phases.js";
import type { ConversationStrategy } from "../../conversation/src/phases.js";
import type { AiService } from "../../conversation/src/services.js";
import { createScenarioServices } from "../../lore/src/services.js";
import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import type { ConversationRuntimeOptions } from "../../conversation/src/runtime.js";
import { accuracyLevels, createJevScorer } from "./jev-scorer.js";
import type { Criterion, Experiment, RunRecording, RuntimeConfig } from "./experiment.js";

export interface ReviewCase extends ConversationReviewContext {
  name: string;
  expectations: string;
  /** Fresh world, optionally loaded with ordered variant document overlays. */
  loadWorld(overlays: readonly string[]): WorldState;
}
export interface ReviewVariant {
  name: string;
  conversation?: ReviewConversationFactory;
  overlays?: readonly string[];
  strategies?: ConversationRuntimeOptions["strategies"];
}
const judgedCriteria: readonly Criterion[] = [
  { name: "grounding", description: renderPrompt("review-experiment-description-1") },
  { name: "coverage", description: renderPrompt("review-experiment-memory") },
  { name: "knowledge", description: renderPrompt("review-experiment-knowledge") },
  { name: "intent", description: renderPrompt("review-experiment-activities") },
  { name: "preservation", description: renderPrompt("review-experiment-description-2") },
  { name: "restraint", description: renderPrompt("review-experiment-description-3") },
];
export const reviewRubric: readonly Criterion[] = [
  ...judgedCriteria.map(criterion => ({ ...criterion, levels: accuracyLevels })),
  { name: "physical-state", description: renderPrompt("review-experiment-description-4") },
];

export function documentChanges(recording: RunRecording) {
  const before = (recording.initialState as WorldState | undefined)?.docs ?? {};
  const after = (recording.finalState as WorldState | undefined)?.docs ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(path => !isDeepStrictEqual(before[path], after[path]))
    .map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
}

/** Include each successfully touched file once, at its final state (null means deleted). */
export function finalTouchedDocuments(recording: RunRecording) {
  // Also capture typed inventory updates, which change documents outside the docs service.
  const paths = new Set(documentChanges(recording).map(change => change.path));
  for (const call of recording.calls) {
    if (call.service !== "docs" || call.method === "read" || call.outcome?.status !== "returned") continue;
    const args = call.args as unknown[];
    if (call.method === "commit") {
      for (const write of args[0] as { path: string }[]) paths.add(write.path);
    } else if (typeof args[0] === "string") paths.add(args[0]);
  }
  const docs = (recording.finalState as WorldState | undefined)?.docs ?? {};
  return [...paths].sort().map(path => ({ path, document: docs[path] ?? null }));
}

/** Judge final files, without intermediate versions, tool payloads or unrelated world state. */
export function reviewEvidence(testCase: ReviewCase, recording: RunRecording) {
  return { transcript: testCase.transcript, participants: testCase.participants, characterId: testCase.characterId,
    expectations: testCase.expectations, error: recording.error,
    documents: finalTouchedDocuments(recording) };
}

export function createReviewExperiment(testCase: ReviewCase, variants: readonly ReviewVariant[], createAi: () => AiService,
  judge: Pick<AiService, "decisions">): Experiment {
  const conversations = new WeakMap<ConversationStrategy, ReviewConversation>();
  const config = (variant: ReviewVariant): RuntimeConfig => ({ name: variant.name, configure() {
    const backing = createScenarioServices(testCase.loadWorld(variant.overlays ?? []));
    const conversation = variant.conversation?.(testCase) ?? { strategy: { ...(variant.strategies?.conversation ?? directConversationStrategy) }, drain: async () => {} };
    const replay: ReviewConversation = { ...conversation };
    conversations.set(conversation.strategy, replay);
    return { recordServices: ["docs"], services: { inventory: () => backing.inventory, docs: () => backing.docs, scenario: () => backing.scenario, ai: () => createAi(),
      map: services => ({ observe: characterId => ({ characterId, map: services.scenario.read().simulation!.map!, actions: [] }) }),
      character: services => ({ respond: async (request, signal) => {
        const draft = replay.draft;
        delete replay.draft;
        return draft ?? services.ai.responses(request, signal, { purpose: "dialogue" });
      } }),
      lore: services => documentLoreService(services.scenario), debug: () => ({ record: () => {} }) },
      strategies: { ...defaultWorldStrategies, ...variant.strategies, conversation: conversation.strategy,
        review: { ...defaultWorldStrategies.review, ...variant.strategies?.review } } };
  } });
  const score = createJevScorer(reviewRubric.slice(0, -1), recording => reviewEvidence(testCase, recording), judge);
  return { name: testCase.name, type: "review", rubric: reviewRubric,
    getBaseline: () => config({ name: "game" }), getVariants: () => variants.map(config),
    async run(runtime, signal) {
      const conversation = conversations.get(runtime.strategies.conversation)!;
      try {
        const transcript = await replayConversation(testCase, conversation, runtime, signal);
        await conversation.drain();
        await runConversationReview({ characterId: testCase.characterId, participants: testCase.participants,
          transcript }, runtime, signal);
      } finally {
        await conversation.drain();
      }
    },
    summarise(recording) {
      const changes = documentChanges(recording), writes = recording.getServiceRecord("docs").filter(call => call.method !== "read");
      return `${changes.length} changed documents; ${writes.length} write calls`;
    },
    async score(recording, context) {
      const result = await score(recording, context);
      const before = recording.initialState as WorldState | undefined, after = recording.finalState as WorldState | undefined;
      result.criteria["physical-state"] = { score: before && after && isDeepStrictEqual(before.simulation!.map, after.simulation!.map) ? 1 : 0 };
      return result;
    },
  };
}
