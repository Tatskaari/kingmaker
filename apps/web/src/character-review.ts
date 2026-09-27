import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ConversationMemorySchema, EventSchema, type Scenario } from "../../../packages/contracts/src/index.js";
import { MemoryGame } from "../../../packages/core/src/game.js";
import type { NpcActivity } from "./runtime.js";

export type ReviewKind = "conversation_review" | "npc_resolution" | "outcome_review" | "illegal_action";
export interface WorldChange { name: string; arguments: Record<string, unknown> }
export interface CharacterReview {
  kind: ReviewKind;
  participants: string[];
  output: Record<string, unknown>;
  worldChanges: WorldChange[];
  eligibleListeners: string[];
  allowNextGoal: boolean;
}

/** Validate all participants in a private candidate before publishing any state. */
export function applyCharacterReview(scenario: Scenario, review: CharacterReview, activities: Record<string, NpcActivity>) {
  const { kind, participants, output, allowNextGoal } = review;
  const summary = kind === "npc_resolution" ? output.summary : undefined;
  if (kind === "npc_resolution" && (typeof summary !== "string" || !summary.trim())) throw new Error("Invalid conversation summary.");
  const memories = participants.map((id, index) => {
    const value = kind === "npc_resolution" ? output[index === 0 ? "initiator" : "recipient"] : output;
    if (!value || typeof value !== "object" || Array.isArray(value) || !("newEvents" in value) || !("relationships" in value)
      || !Array.isArray(value.newEvents) || !Array.isArray(value.relationships) || !("goalUpdate" in value) || !("lore" in value)) throw new Error("Character returned incomplete conversation memory.");
    const memory = fromJson(ConversationMemorySchema, value as JsonValue);
    if (!memory.goalUpdate) scenario.characters.find(character => character.id === id)!.currentGoal = "";
    if (typeof summary === "string") memory.newEvents.push(create(EventSchema, { type: "npc_conversation", summary }));
    return { id, memory };
  });
  const game = new MemoryGame(scenario), updates: Record<string, NpcActivity> = {};
  for (const { id, memory } of memories) {
    const committed = game.commitConversation(id, memory, kind === "conversation_review");
    if (!committed.ok) throw new Error(committed.issues.map(issue => issue.message).join("; "));
    if (kind === "outcome_review") {
      const activity = activities[id];
      if (!activity?.reviewPending) throw new Error("Task no longer awaits review.");
      updates[id] = memory.goalUpdate && allowNextGoal ? { status: "active", goal: memory.goalUpdate.goal, history: [] }
        : { ...structuredClone(activity), reviewPending: false, goal: memory.goalUpdate ? activity.goal : "" };
    } else {
      updates[id] = { status: memory.goalUpdate ? "active" : "idle", goal: memory.goalUpdate?.goal ?? "", history: typeof summary === "string" ? [summary] : [] };
    }
  }
  return { game, updates, summary };
}
