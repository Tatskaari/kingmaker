import { isDeepStrictEqual } from "node:util";
import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import type { ConversationReviewContext } from "../../conversation/src/review.js";
import { runConversationReview } from "../../conversation/src/review.js";
import { documentLoreService } from "../../conversation/src/document-lore.js";
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
  overlays?: readonly string[];
  /** Optional isolated candidate service implementation; production baseline uses the normal factory. */
  createServices?: (world: WorldState) => Pick<ReturnType<typeof createScenarioServices>, "docs" | "scenario">;
  strategies?: ConversationRuntimeOptions["strategies"];
}
const judgedCriteria: readonly Criterion[] = [
  { name: "grounding", description: "New facts are supported by conversation or existing context; binding GM rulings are preserved." },
  { name: "coverage", description: "Consequential promises, revelations and outcomes in the case expectations are retained in appropriate documents." },
  { name: "knowledge", description: "Each character learns only what they could know; private beliefs and GM truth retain the correct audience." },
  { name: "intent", description: "Every activated activity, including its success_criteria and all steps of current_goal, is executable under the case expectations and current map. If the case identifies an unsupported destination, FAIL an active activity that requires setting out, travelling to, or reaching it, even if the goal starts with preparation or coordination. A purely local next step or explicit deferral until a supported route exists can PASS. Preserve the promise without claiming completed travel." },
  { name: "preservation", description: "Unrelated facts, characterization and permissions are preserved." },
  { name: "restraint", description: "Changes are relevant and avoid redundant memories, unnecessary rewrites and invented consequences." },
];
export const reviewRubric: readonly Criterion[] = [
  ...judgedCriteria.map(criterion => ({ ...criterion, levels: accuracyLevels })),
  { name: "physical-state", description: "Review leaves the physical map unchanged (deterministic 0 or 1 invariant)." },
];

export function documentChanges(recording: RunRecording) {
  const before = (recording.initialState as WorldState | undefined)?.docs ?? {};
  const after = (recording.finalState as WorldState | undefined)?.docs ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(path => !isDeepStrictEqual(before[path], after[path]))
    .map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
}

/** Grade actual persisted state, including partial failures, plus the calls that attempted edits. */
export function reviewEvidence(testCase: ReviewCase, recording: RunRecording) {
  const before = recording.initialState as WorldState | undefined, after = recording.finalState as WorldState | undefined;
  const changes = documentChanges(recording);
  const paths = new Set(changes.map(change => change.path));
  const entry = before?.runtimeCharacters[testCase.characterId]?.document;
  if (entry) paths.add(entry);
  for (const call of recording.getCalls()) {
    if ((call.service === "docs" && call.method === "read") || (call.service === "scenario" && call.method === "getDocument")) {
      const path = (call.args as unknown[])[0];
      if (typeof path === "string") paths.add(path);
    }
  }
  return { transcript: testCase.transcript, participants: testCase.participants, characterId: testCase.characterId,
    expectations: testCase.expectations, error: recording.error,
    contextDocuments: [...paths].flatMap(path => before?.docs[path] ? [{ path, document: before.docs[path] }] : []),
    changes, updates: recording.getServiceRecord("docs").filter(call => call.method !== "read"),
    beforeIntent: before?.runtimeCharacters, afterIntent: after?.runtimeCharacters,
    reviewedCharacterIntent: (() => {
      const actor = after?.runtimeCharacters[testCase.characterId];
      return { actor, activity: actor?.activity ? after?.docs[actor.activity] : null,
        wait: actor?.wait ? after?.docs[actor.wait] : null };
    })(),
    physicalState: before?.map?.actors, rooms: before?.map?.rooms.map(({ id, name }) => ({ id, name })) };
}

export function createReviewExperiment(testCase: ReviewCase, variants: readonly ReviewVariant[], createAi: () => AiService,
  judge: Pick<AiService, "decisions">): Experiment {
  const config = (variant: ReviewVariant): RuntimeConfig => ({ name: variant.name, configure() {
    const backing = (variant.createServices ?? createScenarioServices)(clone(WorldStateSchema, testCase.loadWorld(variant.overlays ?? [])));
    return { services: { docs: () => backing.docs, scenario: () => backing.scenario, ai: () => createAi(),
      lore: services => documentLoreService(services.scenario), debug: () => ({ record: () => {} }) },
      strategies: { ...defaultWorldStrategies, ...variant.strategies,
        review: { ...defaultWorldStrategies.review, ...variant.strategies?.review } } };
  } });
  const score = createJevScorer(reviewRubric.slice(0, -1), recording => reviewEvidence(testCase, recording), judge);
  return { name: testCase.name, rubric: reviewRubric,
    getBaseline: () => config({ name: "game" }), getVariants: () => variants.map(config),
    async run(runtime, signal) {
      await runConversationReview({ characterId: testCase.characterId, participants: testCase.participants,
        transcript: structuredClone(testCase.transcript) }, runtime, signal);
    },
    summarise(recording) {
      const changes = documentChanges(recording), writes = recording.getServiceRecord("docs").filter(call => call.method !== "read");
      return `${changes.length} changed documents; ${writes.length} write calls; ${recording.getServiceRecord("ai").length} AI calls`;
    },
    async score(recording, context) {
      const result = await score(recording, context);
      const before = recording.initialState as WorldState | undefined, after = recording.finalState as WorldState | undefined;
      result.criteria["physical-state"] = { score: before && after && isDeepStrictEqual(before.map, after.map) ? 1 : 0 };
      return result;
    },
  };
}
