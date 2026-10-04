import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type TranscriptMessage } from "../../contracts/src/index.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { prepareConversation } from "../../conversation/src/conversation.js";
import { ConversationReviews, liveConversationStrategy } from "../../conversation/src/live-conversation-strategy.js";
import { runConversation, type ConversationStrategy } from "../../conversation/src/phases.js";
import type { ConversationRuntime } from "../../conversation/src/runtime.js";
import type { ReviewCase, ReviewVariant } from "./review-experiment.js";

export interface ReviewConversation {
  strategy: ConversationStrategy;
  draft?: OpenRouterMessage;
  drain(): Promise<void>;
}
export type ReviewConversationFactory = (testCase: ReviewCase) => Omit<ReviewConversation, "draft">;

export const liveReviewVariant: ReviewVariant = { name: "live-review", conversation(testCase) {
  const reviews = new ConversationReviews();
  return { strategy: liveConversationStrategy({ characterId: testCase.characterId, reviews }), drain: () => reviews.drain() };
} };

/** Mock the engine's turn loop using the existing dialogue and already-resolved dice. */
export async function replayConversation(testCase: ReviewCase, conversation: ReviewConversation,
  runtime: ConversationRuntime, signal: AbortSignal): Promise<TranscriptMessage[]> {
  const accepted: TranscriptMessage[] = [];
  for (const turn of testCase.transcript) {
    signal.throwIfAborted();
    if (turn.role !== TranscriptRole.CHARACTER) { accepted.push(structuredClone(turn)); continue; }
    await conversation.drain();
    conversation.draft = { role: "assistant", content: turn.text };
    const playerIndex = accepted.findLastIndex(item => item.role === TranscriptRole.PLAYER);
    if (playerIndex < 0) throw new Error("Replay needs a player turn");
    const services = runtime.services;
    const lore = await services.lore.forCharacter(testCase.characterId, signal);
    const request = await prepareConversation({ snapshot: { world: services.scenario.snapshot() },
      characterId: testCase.characterId, sources: lore.initial, transcript: accepted.slice(0, playerIndex),
      message: accepted[playerIndex]!.text }, services, signal);
    request.messages = [...request.messages, ...accepted.slice(playerIndex + 1).map(item => ({ role: "system" as const, content: item.text }))];
    const reply = await runConversation(request, runtime, signal);
    accepted.push(create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER,
      speakerId: testCase.characterId, text: reply.content ?? "" }));
  }
  return accepted;
}
