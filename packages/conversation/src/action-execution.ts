import type { MapCommand, MapResult } from "./map.js";
import type { RuntimeServices } from "./services.js";

export interface ActionExecutionContext { command: MapCommand }
export type ActionExecutionLabels = Record<string, unknown>;
export interface ActionExecutionHooks {
  classify(context: Readonly<ActionExecutionContext>, signal: AbortSignal, services: RuntimeServices): Promise<ActionExecutionLabels>;
  resolve(context: Readonly<ActionExecutionContext>, labels: Readonly<ActionExecutionLabels>, signal: AbortSignal, services: RuntimeServices): Promise<MapResult>;
}
/** Physical rules stay in the map service; policy and presentation are replaceable. */
export const mapActionHooks: ActionExecutionHooks = {
  classify: async () => ({}),
  async resolve(context, _labels, signal, services) {
    signal.throwIfAborted();
    return services.map.interact(context.command);
  },
};
export async function runActionExecution(context: ActionExecutionContext,
  runtime: { services: RuntimeServices; hooks: { actionExecution: ActionExecutionHooks } }, signal: AbortSignal) {
  signal.throwIfAborted();
  const evidence = structuredClone(context);
  const labels = await runtime.hooks.actionExecution.classify(structuredClone(evidence), signal, runtime.services);
  signal.throwIfAborted();
  return runtime.hooks.actionExecution.resolve(evidence, labels, signal, runtime.services);
}
