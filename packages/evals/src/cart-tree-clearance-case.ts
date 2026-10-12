import { resolve } from "node:path";
import type { WorldState } from "../../contracts/src/v2.js";
import type { AiService } from "../../conversation/src/services.js";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { activityTools } from "../../conversation/src/activity-tools.js";
import { reviewDocumentEvidence } from "../../conversation/src/document-review.js";
import { advanceQuestTool, gameMasterTools } from "../../conversation/src/gm-tools.js";
import { directConversationStrategy } from "../../conversation/src/phases.js";
import { reviewPromptContext } from "../../conversation/src/review-prompt-context.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import worldFixture from "../../../evals/reviews/cart-tree-clearance/world.json" with { type: "json" };
import { createReviewExperiment, type ReviewCase, type ReviewVariant } from "./review-experiment.js";
import { loadTranscriptFixture, withTranscriptFixture } from "./transcript-fixture.js";

const root = resolve(import.meta.dirname, "../../..");
const fixture = loadTranscriptFixture(`${root}/evals/reviews/cart-tree-clearance/fixture.json`);

export const cartTreeClearanceCase: ReviewCase = {
  name: "cart-tree-clearance",
  characterId: fixture.characterId,
  participants: [fixture.characterId, "player"],
  transcript: fixture.transcript,
  expectations: "Treat Rowan's observed successful tree transfer as authoritative plot and physical-world progress. Advance Assembly Programme from cart_blocked to cart_unblocked through its authored clearance hook, clear the blocking cart fixture, preserve the safely placed gift tree and publish the shared cart-cleared milestone. Do not merely describe or document the outcome, leave a stale blocked-cart activity, or claim the cushions and supplies have already arrived.",
  loadWorld(overlays) {
    const world = loadPlayableWorld(undefined, [fixture.overlay, ...overlays]);
    const quest = world.quests[worldFixture.quest.id]!;
    quest.active = worldFixture.quest.active;
    quest.currentStageId = worldFixture.quest.stage;
    quest.revision = worldFixture.quest.revision;
    quest.history = [];
    const rowan = world.simulation!.runtimeCharacters.rowan!;
    rowan.activity = worldFixture.activity;
    rowan.wait = undefined;
    rowan.intentRevision = 1;
    for (const [id, position] of Object.entries(worldFixture.positions)) {
      const actor = world.simulation!.map!.actors.find(candidate => candidate.characterId === id)!;
      actor.roomId = position.roomId;
      Object.assign(actor.position!, { x: position.x, y: position.y });
    }
    return refreshDocumentGraph(world);
  },
};

const rubric = [
  { name: "quest-advanced", description: "Assembly Programme reached cart_unblocked through the authoritative quest transition." },
  { name: "obstruction-cleared", description: "The blocking left cart fixture is absent and the safely placed gift tree remains beside the entrance." },
  { name: "milestone-broadcast", description: "The cart-cleared public milestone and its pending plot-review job were created." },
  { name: "delivery-pending", description: "Clearance did not falsely complete delivery of the cushions or supplies." },
] as const;

/** Isolate the review that must connect the completed physical outcome to authored plot state. */
const plotReview = (): ReviewVariant["strategies"] => ({
  conversation: directConversationStrategy,
  review: {
    classify: async () => ({ plot_progress: { choice: "flagged" } }),
    resolve: (context, labels, signal, services) => reviewDocumentEvidence(context, labels, signal,
      { ...services, ai: { ...services.ai, responses: (request, cancellation, info) => services.ai.responses(
        { ...request, reasoning: { effort: "high" } }, cancellation, { ...info, purpose: "conversation_review" }) } },
      renderPrompt("review-plot-progress", reviewPromptContext(context, services)), {
        systemPrompt: renderPrompt("review-system"),
        tools: [
          ...gameMasterTools.filter(tool => !activityTools.some(activity => activity.function.name === tool.function.name)),
          advanceQuestTool,
        ],
      }),
  },
});

export const focusedCartPlotBaseline: ReviewVariant = { name: "game", strategies: plotReview() };

export function createCartTreeClearanceExperiment(createAi: () => AiService, judge: Pick<AiService, "decisions">) {
  const base = createReviewExperiment(cartTreeClearanceCase, [focusedCartPlotBaseline], createAi, judge);
  const [baseline] = base.getVariants();
  const config = withTranscriptFixture(baseline!, fixture);
  return { ...base, rubric, getBaseline: () => config, getVariants: () => [],
    summarise(recording: Parameters<typeof base.summarise>[0]) {
      const world = recording.finalState as WorldState | undefined;
      const stage = world?.quests.assembly_programme?.currentStageId ?? "missing";
      const blocked = world?.simulation?.map?.fixtures.some(item => item.id === "furn_cart_left") ?? true;
      return `quest ${stage}; obstruction ${blocked ? "present" : "cleared"}; milestone ${world?.docs["Reviews/cart-cleared.md"] ? "present" : "missing"}`;
    },
    async score(recording: Parameters<typeof base.score>[0]) {
      const before = recording.initialState as WorldState;
      const after = recording.finalState as WorldState;
      const fixtures = after.simulation!.map!.fixtures;
      const questAdvanced = before.quests.assembly_programme!.currentStageId === "cart_blocked"
        && after.quests.assembly_programme!.currentStageId === "cart_unblocked";
      const obstructionCleared = !fixtures.some(item => item.id === "furn_cart_left")
        && fixtures.some(item => item.id === "furn_cart_right" && /tree/i.test(item.name));
      const milestone = after.docs["Reviews/cart-cleared.md"];
      const memories = Object.keys(after.docs).filter(path => path.endsWith("/cart-cleared.md"));
      const deliveryPending = !Object.values(after.docs).some(document =>
        document.frontmatter?.summary === "The cushions have arrived in the Great Hall");
      return { criteria: {
        "quest-advanced": { score: Number(questAdvanced) },
        "obstruction-cleared": { score: Number(obstructionCleared) },
        "milestone-broadcast": { score: Number(!!milestone && memories.length > 0) },
        "delivery-pending": { score: Number(deliveryPending) },
      } };
    },
  };
}
