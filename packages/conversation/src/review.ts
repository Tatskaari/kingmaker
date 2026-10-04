import type { TranscriptMessage } from "../../contracts/src/index.js";
import type { RuntimeServices } from "./services.js";
import type { ConversationRuntime } from "./runtime.js";

export type ReviewLabels = Record<string, unknown>;
export interface ConversationReviewContext {
  characterId: string;
  participants: readonly string[];
  /** Complete evidence, including authoritative GM rulings. */
  transcript: readonly TranscriptMessage[];
}
export interface ConversationReviewResult { summary: string }
export interface ConversationReviewStrategy<Labels = ReviewLabels> {
  classify(context: Readonly<ConversationReviewContext>, signal: AbortSignal, services: RuntimeServices): Promise<Labels>;
  resolve(context: Readonly<ConversationReviewContext>, labels: Readonly<Labels>, signal: AbortSignal, services: RuntimeServices): Promise<ConversationReviewResult>;
}

/** Placeholder for Jev review classification; empty labels never skip GM review. */
export async function classifyConversationReview(_context: Readonly<ConversationReviewContext>, signal: AbortSignal): Promise<ReviewLabels> {
  signal.throwIfAborted();
  return {};
}

/** One classify/resolve pass. The host owns transcript cleanup after success. */
export async function runConversationReview<Labels>(context: ConversationReviewContext,
  runtime: ConversationRuntime<Labels>, signal: AbortSignal = new AbortController().signal): Promise<ConversationReviewResult> {
  const evidence = structuredClone(context);
  signal.throwIfAborted();
  const labels = await runtime.strategies.review.classify(structuredClone(evidence), signal, runtime.services);
  signal.throwIfAborted();
  const result = await runtime.strategies.review.resolve(structuredClone(evidence), labels, signal, runtime.services);
  signal.throwIfAborted();
  return result;
}
