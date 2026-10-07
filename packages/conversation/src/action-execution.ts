import type { MapCommand, MapResult } from "./map.js";
import type { RuntimeServices } from "./services.js";

export interface ActionExecutionContext { command: MapCommand }
export type ActionExecutionLabels = Record<string, unknown>;
export interface ActionExecutionStrategy {
  classify(context: Readonly<ActionExecutionContext>, signal: AbortSignal, services: RuntimeServices): Promise<ActionExecutionLabels>;
  resolve(context: Readonly<ActionExecutionContext>, labels: Readonly<ActionExecutionLabels>, signal: AbortSignal, services: RuntimeServices): Promise<MapResult>;
}
/** Physical rules stay in the map service; policy and presentation are replaceable. */
export const mapActionStrategy: ActionExecutionStrategy = {
  classify: async () => ({}),
  async resolve(context, _labels, signal, services) {
    signal.throwIfAborted();
    return services.map.interact(context.command, signal);
  },
};
export async function runActionExecution(context: ActionExecutionContext,
  runtime: { services: RuntimeServices; strategies: { actionExecution: ActionExecutionStrategy } }, signal: AbortSignal) {
  signal.throwIfAborted();
  const evidence = structuredClone(context);
  const labels = await runtime.strategies.actionExecution.classify(structuredClone(evidence), signal, runtime.services);
  signal.throwIfAborted();
  return runtime.strategies.actionExecution.resolve(evidence, labels, signal, runtime.services);
}
