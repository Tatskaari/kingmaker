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
export function traceAiService(ai: AiService, context: (characterId?: string) => AiTraceContext, record: RecordAiSpan, operation: string): AiService {
  const span = (purpose: string, characterId?: string): AiSpan => ({ ...structuredClone(context(characterId)), spanId: crypto.randomUUID(), operation: purpose });
  return {
    responses: (request, signal, info) => record({ ...span(info?.purpose ?? operation, info?.characterId), ...(info?.characterId ? { characterId: info.characterId } : {}) },
      request, () => ai.responses(request, signal, info)),
    decisions: (state, questions, signal, purpose, info) => record(span(purpose ?? operation, info?.characterId), { state, questions },
      () => ai.decisions(state, questions, signal, purpose, info)),
  };
}
