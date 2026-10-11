import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fromJsonString } from "@bufbuild/protobuf";
import { MapStateSchema } from "../../contracts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import { playableWorld } from "../../../apps/web/src/playable-world.js";
import { loadDocumentLayers } from "../../service-tools/src/layered-docs.js";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { reviewDocumentEvidence } from "../../conversation/src/document-review.js";
import { reviewPromptContext } from "../../conversation/src/review-prompt-context.js";
import { directConversationStrategy } from "../../conversation/src/phases.js";
import { gameMasterTools } from "../../conversation/src/gm-tools.js";
import { activityTools } from "../../conversation/src/activity-tools.js";
import type { AiService } from "../../conversation/src/services.js";
import { createReviewExperiment, documentChanges, type ReviewCase, type ReviewVariant } from "./review-experiment.js";
import { createJevScorer, accuracyLevels } from "./jev-scorer.js";
import { loadTranscriptFixture, withTranscriptFixture } from "./transcript-fixture.js";
import source from "../../../evals/reviews/aldren-plot/source.json" with { type: "json" };

const root = resolve(import.meta.dirname, "../../.."), directory = `${root}/evals/reviews/aldren-plot`;
const fixture = loadTranscriptFixture(`${directory}/fixture.json`);
export const aldrenPlotCase: ReviewCase = {
  name: "aldren-plot", characterId: fixture.characterId, participants: ["aldren", "player"], transcript: fixture.transcript,
  expectations: "Honour the successful persuasion: Aldren will approach Holt himself. Adapt the existing quest/dialogue route to that agreed detour, including a concrete future report or invitation that brings the player into the cart blockage beat. Preserve player choices and existing cart solutions. Do not claim the order, discovery, delivery or cart resolution already happened. Memory and the initial activity already exist. Do not duplicate them or move actors. Judge committed document changes, not a final summary's claimed changes.",
  loadWorld(overlays) {
    const base = loadDocumentLayers([`${root}/lore`]);
    // Replace the older quest folder with source notes from the three-stage PR.
    const prefix = "Scenarios/Centennial Assembly/Quests/Assembly Programme/";
    for (const path of base.markdown.keys()) if (path.startsWith(prefix)) base.markdown.delete(path);
    const additions = loadDocumentLayers([fixture.overlay, ...overlays]);
    const trees: string[] = [];
    for (const [path, text] of additions.markdown) {
      if (path.startsWith("Conversations/")) trees.push(text);
      else base.markdown.set(path, text);
    }
    // This base predates trigger:none. Compile its structural equivalent only;
    // no quest scheduler runs in this focused review. Restore authored metadata below.
    const none = [...base.markdown].filter(([, text]) => /^trigger: none$/m.test(text));
    for (const [path, text] of none) base.markdown.set(path, text.replace(/^trigger: none$/m, "trigger: discretionary"));
    const world = playableWorld(fromJsonString(MapStateSchema, readFileSync(`${root}/content/palace-map.json`, "utf8")), base.markdown, base.sidecars, trees);
    for (const [path] of none) world.docs[path]!.frontmatter!.trigger = "none";
    world.quests.assembly_programme!.active = true;
    world.quests.talk_to_aldren!.currentStageId = "completed";
    world.quests.talk_to_aldren!.active = false;
    world.quests["conversation-aldren-cushions"]!.currentStageId = "helping";
    const actor = world.simulation!.runtimeCharacters.aldren!;
    actor.activity = source.activity; actor.wait = undefined; actor.intentRevision = 1;
    const body = world.simulation!.map!.actors.find(actor => actor.characterId === "aldren")!;
    body.roomId = source.physicalState.roomId;
    Object.assign(body.position!, { x: source.physicalState.position.x, y: source.physicalState.position.y });
    return refreshDocumentGraph(world);
  },
};

export const focusedPlotBaseline: ReviewVariant = { name: "game", strategies: {
  conversation: directConversationStrategy,
  review: {
    classify: async () => ({ plot_progress: { choice: "flagged" } }),
    resolve: (context, labels, signal, services) => reviewDocumentEvidence(context, labels, signal,
      { ...services, ai: { ...services.ai, responses: (request, cancellation, info) => services.ai.responses(
        { ...request, reasoning: { effort: "high" } }, cancellation, { ...info, purpose: "conversation_review" }) } },
      renderPrompt("review-plot-progress", reviewPromptContext(context, services)), {
        systemPrompt: renderPrompt("review-system"),
        tools: gameMasterTools.filter(tool => !activityTools.some(activity => activity.function.name === tool.function.name)),
      }),
  },
} };

const rubric = [
  { name: "delegation", description: "Committed documents preserve Aldren's successful agreement to approach Holt himself, without assigning the original errand back to the player or undoing the check." },
  { name: "player-return", description: "Committed quest or dialogue edits establish a concrete future report/invitation that brings the player into the next story beat after Aldren approaches Holt. A suggestion only in the review summary earns no credit; no relevant edits earns zero." },
  { name: "reconnection", description: "Committed quest/dialogue edits connect the agreed royal intervention naturally to the authored cart blockage, retaining player agency and alternative solutions. No relevant edits earns zero." },
  { name: "grounding", description: "Edits preserve existing facts, scoped NPC knowledge and unresolved status. They distinguish future conditional plans from completed actions; no invented delivered order, discovered blockage, moved cart or arrived cushions." },
].map(item => ({ ...item, levels: accuracyLevels }));

export function createAldrenPlotExperiment(createAi: () => AiService, judge: Pick<AiService, "decisions">) {
  const base = createReviewExperiment(aldrenPlotCase, [focusedPlotBaseline], createAi, judge);
  const [baseline] = base.getVariants();
  const score = createJevScorer(rubric, recording => ({ transcript: fixture.transcript,
    expectations: aldrenPlotCase.expectations, changes: documentChanges(recording) }), judge);
  return { ...base, rubric: [...rubric, { name: "runtime-preserved", description: "Review preserves physical state, current quest stages, activation and transition history; validated definition edits may update compiled graphs and revisions." }],
    getBaseline: () => withTranscriptFixture(baseline!, fixture),
    getVariants: () => [],
    async score(recording: Parameters<typeof score>[0], context: Parameters<typeof score>[1]) {
      const result = await score(recording, context);
      const before = recording.initialState as WorldState, after = recording.finalState as WorldState;
      const progress = (world: WorldState) => Object.fromEntries(Object.entries(world.quests).map(([id, state]) =>
        [id, { currentStageId: state.currentStageId, active: state.active, history: state.history }]));
      result.criteria["runtime-preserved"] = { score: isDeepStrictEqual(before.simulation, after.simulation) && isDeepStrictEqual(progress(before), progress(after)) ? 1 : 0 };
      return result;
    },
  };
}
