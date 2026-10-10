import { PLAYER_OBSERVATION_PREFIX } from "./checks.js";
import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type TranscriptMessage } from "../../contracts/src/index.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { analyzeAttention, type AnalysisEvent } from "./attention.js";
import { reviewDocumentEvidence } from "./document-review.js";
import type { ConversationStrategy } from "./phases.js";

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
    const flagged = discretion || Object.values(labels).some(label => label.choice === "flagged");
    const transcript = turnEvidence(messages.slice(playerIndex), reply, options.characterId);
    const review = async (reviewSignal: AbortSignal) => {
      await reviewDocumentEvidence({ characterId: options.characterId, participants: [options.characterId, "player"], transcript },
        labels, reviewSignal, { ...services, ai: { ...services.ai,
          responses: (request, signal, info) => services.ai.responses({ ...request, reasoning: { ...request.reasoning, effort: "high" } },
            signal, { ...info, purpose: "conversation_review" }),
        } },
        "Review only this newly accepted conversation turn. Earlier turns have already been reviewed; do not repeat gifts or objectives. Preserve consequences in the world now, including inventory changes for agreed gifts/trades. Character movement is not executed by narration. Retain supported promises and player-led shared history as appropriate memories or beliefs.");
      record("resolve", "live-review", { mode: "background" }, pass);
    };
    signal.throwIfAborted();
    if (flagged) options.reviews.enqueue(review);
    record("respond", "live-accepted", { reply, mode: flagged ? "background" : "none" }, pass);
    return reply;
  } };
}

function turnEvidence(messages: readonly OpenRouterMessage[], reply: OpenRouterMessage, characterId: string): TranscriptMessage[] {
  return [...messages.filter(message => message.role === "user" || (message.role === "system" && (message.content?.startsWith("# Binding DM ruling") || message.content?.startsWith(PLAYER_OBSERVATION_PREFIX)))), reply]
    .map(message => create(TranscriptMessageSchema, { role: message.role === "user" ? TranscriptRole.PLAYER : message.role === "assistant" ? TranscriptRole.CHARACTER : TranscriptRole.GAME_MASTER,
      speakerId: message.role === "user" ? "player" : message.role === "assistant" ? characterId : "GM", text: message.content ?? "" }));
}
