import { QuestConflictError, type QuestService } from "../../lore/src/quest-service.js";

/** Expected gameplay outcomes; unexpected execution failures still throw. */
export type TransitionResult =
  | { status: "accepted"; message?: string }
  | { status: "rejected"; message: string };
export type TransitionHook = (signal: AbortSignal) => Promise<TransitionResult>;

/** Host orchestration, not a transaction: hooks must reject before applying effects. */
export async function transitionWithHook(quests: QuestService, questId: string,
  transitionId: string, expectedRevision: number, signal: AbortSignal,
  hook?: TransitionHook, evidence?: string): Promise<TransitionResult> {
  signal.throwIfAborted();
  const state = quests.read(questId);
  if (state.revision !== expectedRevision) throw new QuestConflictError(questId);
  if (!quests.availableTransitions(questId).some(edge => edge.id === transitionId)) {
    throw new Error(`${questId}: transition ${transitionId} is not available`);
  }
  const result = hook ? await hook(signal) : { status: "accepted" } as const;
  signal.throwIfAborted();
  if (result.status === "rejected") return result;
  await quests.transition(questId, transitionId, expectedRevision, evidence);
  return result;
}
