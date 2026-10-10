import { clone, create } from "@bufbuild/protobuf";
import { QuestSchema, QuestStateSchema, QuestTransitionRecordSchema,
  type Quest, type QuestState, type QuestTransition } from "../../contracts/src/v2.js";
import type { WorldStore } from "./world-store.js";

export interface QuestService {
  list(): QuestState[];
  listActive(): QuestState[];
  read(id: string): QuestState;
  /** Outgoing edges only; callers must adjudicate their conditions. */
  availableTransitions(id: string): QuestTransition[];
  register(quest: Quest): Promise<QuestState>;
  /** Toggle GM/host activation without changing quest progress. */
  setActive(id: string, active: boolean, expectedRevision: number): Promise<QuestState>;
  /** Record an adjudicated transition. Does not execute scripts or world effects. */
  transition(id: string, transitionId: string, expectedRevision: number, evidence?: string): Promise<QuestState>;
}

export class QuestConflictError extends Error {
  constructor(readonly questId: string) {
    super(`${questId}: quest changed; read it again before updating`);
    this.name = "QuestConflictError";
  }
}

export function validateQuest(quest: Quest): void {
  const ids = (kind: string, entries: readonly { id: string }[]) => {
    const seen = new Set<string>();
    for (const { id } of entries) {
      if (!id.trim() || seen.has(id)) throw new Error(`${quest.id}: empty or duplicate ${kind} ID: ${id}`);
      seen.add(id);
    }
    return seen;
  };
  if (!quest.id.trim()) throw new Error("Quest ID is required");
  const stages = ids("stage", quest.stages);
  ids("transition", quest.transitions);
  if (!stages.has(quest.initialStageId)) throw new Error(`${quest.id}: unknown initial stage: ${quest.initialStageId}`);
  for (const edge of quest.transitions) {
    if (!stages.has(edge.fromStageId) || !stages.has(edge.toStageId)) {
      throw new Error(`${quest.id}: transition ${edge.id} references an unknown stage`);
    }
  }
}

/** Quest data shares the document write queue; only the affected quest is copied. */
export function createQuestService(store: WorldStore): QuestService {
  const current = (id: string) => {
    if (!Object.hasOwn(store.state.quests, id)) throw new Error(`${id}: quest not found`);
    return store.state.quests[id]!;
  };
  const snapshot = (state: QuestState) => clone(QuestStateSchema, state);
  const publish = (id: string, state: QuestState) => {
    store.state = { ...store.state, quests: { ...store.state.quests, [id]: state } };
    return snapshot(state);
  };
  return {
    list: () => Object.values(store.state.quests).map(snapshot),
    listActive: () => Object.values(store.state.quests).filter(state => state.active).map(snapshot),
    read: id => snapshot(current(id)),
    availableTransitions(id) {
      const state = snapshot(current(id));
      return state.quest!.transitions.filter(edge => edge.fromStageId === state.currentStageId);
    },
    register(quest) {
      const input = clone(QuestSchema, quest);
      return store.write(async () => {
        validateQuest(input);
        if (Object.hasOwn(store.state.quests, input.id)) throw new Error(`${input.id}: quest already registered`);
        return publish(input.id, create(QuestStateSchema, { quest: input, currentStageId: input.initialStageId }));
      });
    },
    setActive(id, active, expectedRevision) {
      return store.write(async () => {
        const state = current(id);
        if (state.revision !== expectedRevision) throw new QuestConflictError(id);
        if (state.active === active) return snapshot(state);
        if (state.revision === 0xffff_ffff) throw new Error(`${id}: quest revision exhausted`);
        const next = snapshot(state);
        next.active = active;
        next.revision++;
        return publish(id, next);
      });
    },
    transition(id, transitionId, expectedRevision, evidence = "") {
      return store.write(async () => {
        const state = current(id);
        if (state.revision !== expectedRevision) throw new QuestConflictError(id);
        const edge = state.quest!.transitions.find(candidate => candidate.id === transitionId);
        if (!edge || edge.fromStageId !== state.currentStageId) throw new Error(`${id}: transition ${transitionId} is not available`);
        if (state.revision === 0xffff_ffff) throw new Error(`${id}: quest revision exhausted`);
        const next = snapshot(state);
        next.currentStageId = edge.toStageId;
        if (next.quest!.stages.find(stage => stage.id === edge.toStageId)!.completed) next.active = false;
        next.revision++;
        next.history.push(create(QuestTransitionRecordSchema, { transitionId, revision: next.revision, evidence }));
        return publish(id, next);
      });
    },
  };
}
