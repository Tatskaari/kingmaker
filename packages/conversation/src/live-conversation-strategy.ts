import { activityNpcLocations } from "./activity-navigation.js";
import { reviewPromptContext } from "./review-prompt-context.js";
import { PLAYER_OBSERVATION_PREFIX } from "./checks.js";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type TranscriptMessage } from "../../contracts/src/index.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { analyzeAttention, type AnalysisEvent } from "./attention.js";
import { reviewDocumentEvidence } from "./document-review.js";
import type { ConversationStrategy } from "./phases.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { advanceQuestTool, gameMasterTools } from "./gm-tools.js";
import { activityTools } from "./activity-tools.js";
import type { ConversationReviewContext, ReviewLabels } from "./review.js";
import type { RuntimeServices } from "./services.js";

const commitmentFlags = ["immediate_commitment", "deferred_commitment", "general_commitment"];
const reviewCategories = ["improvised_detail", "plot_progress", "other_world_update", "conversational_exchange", "relationship_or_knowledge_change"];

/** One session owns ordered review jobs. Failed work is surfaced at drain, never silently lost. */
export class ConversationReviews {
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private readonly lifetime = new AbortController();
  get signal(): AbortSignal { return this.lifetime.signal; }
  enqueue(work: (signal: AbortSignal) => Promise<void>): void {
    this.tail = this.tail.then(async () => {
      if (this.failure) return;
      try { await work(this.lifetime.signal); } catch (error) { this.failure = error; }
    });
  }
  async drain(): Promise<void> { await this.tail; if (this.failure) throw this.failure; }
  cancel(): void { this.lifetime.abort(); }
}

/** Game response policy; preparation/dice remain outside this response boundary. */
export function liveConversationStrategy(options: {
  characterId: string;
  reviews: ConversationReviews;
  report?: (event: AnalysisEvent) => void;
  /** Experimental hosts may replace the plot-progress reviewer without changing other focused reviews. */
  plotReview?: (context: ConversationReviewContext, labels: ReviewLabels, signal: AbortSignal, services: RuntimeServices) => Promise<void>;
}): ConversationStrategy {
  let turn = 0;
  return { respond: async ({ request }, signal, services) => {
    signal.throwIfAborted();
    const currentTurn = ++turn;
    const messages = [...request.messages];
    const playerIndex = messages.findLastIndex(message => message.role === "user");
    if (playerIndex < 0) throw new Error("Live review requires a player message");
    const record = (stage: "classify" | "resolve" | "respond", source: string, output: unknown, pass: number) =>
      services.debug.record({ turn: currentTurn, pass, source, stage, status: "completed", output });
    const pass = 1;
    signal.throwIfAborted();
    const reply = await services.character.respond({ ...request, messages }, signal);
    signal.throwIfAborted();
    if (reply.role !== "assistant" || !reply.content?.trim() || reply.tool_calls?.length) throw new Error("Expected a plain character draft");
    const labels = await analyzeAttention(services.ai, messages, reply, signal);
    record("classify", "live-attention", labels, pass);
    options.report?.({ kind: "labels", subject: "character", source: "attention", decisions: labels });
    const discretion = labels.immediate_feasibility?.choice === "gms_discretion";
    const commitment = commitmentFlags.some(name => labels[name]?.choice === "flagged");
    const categories = [
      ...(discretion || commitment ? ["activity"] : []),
      ...(commitment ? ["commitment_memory"] : []),
      ...reviewCategories.filter(name => labels[name]?.choice === "flagged" && (name !== "plot_progress" || !options.plotReview)),
    ];
    const transcript = turnEvidence(messages.slice(playerIndex), reply, options.characterId);
    signal.throwIfAborted();
    if (options.plotReview && labels.plot_progress?.choice === "flagged") {
      const context = { characterId: options.characterId, participants: [options.characterId, "player"], transcript };
      options.reviews.enqueue(reviewSignal => options.plotReview!(context, labels, reviewSignal, services));
    }
    for (const category of categories) options.reviews.enqueue(async reviewSignal => {
      const names = category === "activity" ? [...commitmentFlags, "immediate_feasibility"]
        : category === "commitment_memory" ? commitmentFlags : [category];
      const reviewLabels = Object.fromEntries(Object.entries(labels).filter(([name]) => names.includes(name)));
      await reviewDocumentEvidence({ characterId: options.characterId, participants: [options.characterId, "player"], transcript },
        reviewLabels, reviewSignal, { ...services, ai: { ...services.ai,
          responses: (request, signal, info) => services.ai.responses({ ...request, reasoning: { ...request.reasoning, effort: "high" } },
            signal, { ...info, purpose: "conversation_review" }),
        } }, renderPrompt(`review-${category.replaceAll("_", "-")}`, {
          ...reviewPromptContext({ characterId: options.characterId, participants: [options.characterId, "player"], transcript }, services),
          ...(category === "activity" ? { npc_locations: activityNpcLocations(services.scenario.read(), options.characterId) } : {}),
        }), {
          systemPrompt: renderPrompt("review-system"),
          tools: category === "activity" ? activityTools.filter(tool => tool.function.name === "set_activity").map(tool => {
            const parameters = tool.function.parameters as { required: string[]; properties: Record<string, unknown> };
            return { ...tool, function: { ...tool.function,
              description: renderPrompt("activity-tools-set-activity", { focused: true }),
              parameters: { ...parameters, properties: Object.fromEntries(Object.entries(parameters.properties)
                .filter(([name]) => parameters.required.includes(name))) },
            } };
          }) : [
            ...gameMasterTools.filter(tool => !activityTools.some(activity => activity.function.name === tool.function.name)),
            ...(category === "plot_progress" ? [advanceQuestTool] : []),
          ],
        });
      record("resolve", "live-review", { mode: "background", category }, pass);
    });
    record("respond", "live-accepted", { reply, mode: categories.length ? "background" : "none", reviews: categories }, pass);
    return reply;
  } };
}

function turnEvidence(messages: readonly OpenRouterMessage[], reply: OpenRouterMessage, characterId: string): TranscriptMessage[] {
  return [...messages.filter(message => message.role === "user" || (message.role === "system" && (message.content?.startsWith("# Binding DM ruling") || message.content?.startsWith(PLAYER_OBSERVATION_PREFIX)))), reply]
    .map(message => create(TranscriptMessageSchema, { role: message.role === "user" ? TranscriptRole.PLAYER : message.role === "assistant" ? TranscriptRole.CHARACTER : TranscriptRole.GAME_MASTER,
      speakerId: message.role === "user" ? "player" : message.role === "assistant" ? characterId : "GM", text: message.content ?? "" }));
}
