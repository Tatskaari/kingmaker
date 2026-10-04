import type { RuntimeServices } from "./services.js";

export type ResolutionContext =
  | { kind: "wait_ended"; characterId: string; instructions: string; observation: string }
  | { kind: "npc_exchange"; characterId: string; targetId: string; goal: string }
  | { kind: "task_outcome"; characterId: string; goal: string; actions: readonly string[];
      result: { reason: string; detail: string }; observation: unknown }
  | { kind: "world_event"; characterId: string; eventId: string; perception: string };
export type ResolutionLabels = Record<string, unknown>;
export interface ResolutionResult { summary: string }
export interface ResolutionStrategy {
  classify(context: Readonly<ResolutionContext>, signal: AbortSignal, services: RuntimeServices): Promise<ResolutionLabels>;
  resolve(context: Readonly<ResolutionContext>, labels: Readonly<ResolutionLabels>, signal: AbortSignal,
    services: RuntimeServices): Promise<ResolutionResult>;
}
export const classifyResolution: ResolutionStrategy["classify"] = async (_context, signal) => {
  signal.throwIfAborted();
  return {};
};

/** The same policy boundary for exchanges, finished tasks and perceived events. */
export async function runResolution(context: ResolutionContext,
  runtime: { services: RuntimeServices; strategies: { resolution: ResolutionStrategy } },
  signal: AbortSignal = new AbortController().signal): Promise<ResolutionResult> {
  const evidence = structuredClone(context);
  signal.throwIfAborted();
  const labels = await runtime.strategies.resolution.classify(structuredClone(evidence), signal, runtime.services);
  signal.throwIfAborted();
  const result = await runtime.strategies.resolution.resolve(evidence, labels, signal, runtime.services);
  signal.throwIfAborted();
  return result;
}
