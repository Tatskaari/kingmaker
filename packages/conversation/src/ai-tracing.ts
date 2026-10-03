import type { AiService } from "./services.js";

/** Host context stays out of model prompts and provider payloads. */
export interface AiTraceContext {
  characterId: string;
  participantIds: string[];
  conversationId: string;
  turnId: string;
  scenario?: string;
  worldGeneration?: string;
  location?: { x: number; y: number };
}
export interface AiSpan extends AiTraceContext {
  spanId: string;
  operation: string;
}
export type RecordAiSpan = <T>(span: AiSpan, request: unknown, call: () => Promise<T>) => Promise<T>;

/** Capture immutable per-call context, including concurrent calls and failed requests. */
export function traceAiService(ai: AiService, context: () => AiTraceContext, record: RecordAiSpan, operation: string): AiService {
  const span = (purpose: string): AiSpan => ({ ...structuredClone(context()), spanId: crypto.randomUUID(), operation: purpose });
  return {
    responses: (request, signal) => record(span(operation), request, () => ai.responses(request, signal)),
    decisions: (state, questions, signal, purpose) => record(span(purpose ?? operation), { state, questions },
      () => ai.decisions(state, questions, signal, purpose)),
  };
}
