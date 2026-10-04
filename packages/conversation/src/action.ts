import type { GameAction } from "../../core/src/actions.js";
import type { JevChoice, jevRequest } from "../../providers/src/jev.js";
import type { RuntimeServices } from "./services.js";

export interface ActionContext {
  characterId: string;
  goal: string;
  request: ReturnType<typeof jevRequest>;
  actions: readonly GameAction[];
}
export interface ActionResult { decision: JevChoice; action: GameAction | undefined }
export interface ActionStrategy {
  classify(context: Readonly<ActionContext>, signal: AbortSignal, services: RuntimeServices): Promise<JevChoice>;
  resolve(context: Readonly<ActionContext>, labels: Readonly<JevChoice>, signal: AbortSignal, services: RuntimeServices): Promise<ActionResult>;
}
export const terminalActions = {
  complete: "The current task is achieved in the live world, even if the broader objective is unfinished. Arrival completes a task to go somewhere for a later conversation.",
  wait: "The current task is still unfinished, and progress now depends entirely on another character initiating a conversation, arriving, deciding, or completing their own work. Choose this instead of inventing a waiting action or repeatedly checking.",
  unable: "No available action can make progress, or essential clarification is needed.",
};
export function actionCriteria(actions: readonly GameAction[]): Record<string, string> {
  const ids = new Set<string>();
  for (const action of actions) {
    if (!action.id || ids.has(action.id) || Object.hasOwn(terminalActions, action.id)) throw new Error("Invalid or duplicate action ID.");
    ids.add(action.id);
  }
  return { ...Object.fromEntries(actions.map(action => [action.id,
    `${action.description}${action.legality === "illegal" ? " This is illegal for this character." : ""}`])), ...terminalActions };
}
export const jevActionStrategy: ActionStrategy = {
  async classify(context, signal, services) {
    const answers = await services.ai.decisions(context.request.state, context.request.questions, signal);
    if (!answers.next) throw new Error("Missing action decision.");
    return answers.next;
  },
  async resolve(context, decision, signal) {
    signal.throwIfAborted();
    const action = context.actions.find(action => action.id === decision.choice);
    if (!Object.hasOwn(context.request.questions.next!.criteria, decision.choice)
      || (!action && !Object.hasOwn(terminalActions, decision.choice))) throw new Error("Jev returned an unavailable action.");
    return { decision: structuredClone(decision), action: action && structuredClone(action) };
  },
};

/** One decision after review activates a goal. The game executes the returned command. */
export async function runAction(context: ActionContext, runtime: { services: RuntimeServices; strategies: { action: ActionStrategy } },
  signal: AbortSignal = new AbortController().signal): Promise<ActionResult> {
  signal.throwIfAborted();
  if (!context.goal.trim()) throw new Error("Action planning requires an active goal.");
  const evidence = structuredClone(context);
  const labels = await runtime.strategies.action.classify(structuredClone(evidence), signal, runtime.services);
  signal.throwIfAborted();
  const result = await runtime.strategies.action.resolve(evidence, labels, signal, runtime.services);
  signal.throwIfAborted();
  return result;
}
