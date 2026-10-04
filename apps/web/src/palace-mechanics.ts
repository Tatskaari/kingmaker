import { createPhysicalEvent } from "./physical-event.js";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ScenarioSchema, TranscriptMessageSchema, TilePositionSchema, GamePhase, type Scenario, type Event } from "../../../packages/contracts/src/index.js";
import { fixtureActions, applyFixtureAction } from "../../../packages/core/src/fixtures.js";
import { inventoryOwners, findItem } from "../../../packages/core/src/inventory.js";
import { courtAgentObservation } from "./court-agent.js";
import { courtRoomAt } from "./court-map.js";
import { gameLogger } from "../../../packages/observability/src/logging.js";
const npcLog = gameLogger("npc");
type EventDetails = Record<string, JsonValue>;
export interface NpcActivity {
  activityDocument?: string | null;
  status: "idle" | "active";
  goal: string;
  history: string[];
  /** Exact completed action IDs for the text planner; older saves may omit these. */
  actionIds?: string[];
  result?: { reason: "complete" | "unable" | "wait" | "error" | "limit" | "cancelled"; detail: string };
  reviewPending?: boolean;
}

export interface MechanicalActivity {
  npcActivities?: Record<string, NpcActivity>;
  conversations: Record<string, JsonValue[]>;
  conversationReplyOptions?: Record<string, string[]>;
  conversationEndRequested?: Record<string, boolean>;
}
function fixtureEventContext(scenario: Scenario, actorId: string, actionId: string) {
  const action = fixtureActions(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), actorId).find(candidate => candidate.id === actionId);
  if (!action || action.target === actorId) return { details: {} as EventDetails };
  const fixture = scenario.world?.fixtures.find(candidate => candidate.id === action.target);
  const item = findItem(inventoryOwners(scenario.characters, scenario.world), action.itemId ?? "");
  const owner = scenario.characters.find(character => character.id === fixture?.ownerCharacterId);
  const details: EventDetails = {
    action: action.verb,
    legality: action.legality,
    fixtureId: fixture?.id ?? action.target,
    fixtureName: fixture?.name ?? action.target,
    ...(item ? { itemId: item.id, itemName: item.name } : {}),
    ...(owner ? { ownerCharacterId: owner.id, ownerName: owner.name } : {}),
  };
  const describe = (actorName: string, fallback: string) => {
    if (action.legality !== "illegal" || !owner || !fixture) return `${actorName}: ${fallback}`;
    if (action.verb === "take" && item) return `${actorName} stole ${item.name} from ${owner.name}'s ${fixture.name}.`;
    if (action.verb === "open") return `${actorName} opened ${owner.name}'s ${fixture.name} without permission. ${fallback}`;
    if (action.verb === "inspect" && item) return `${actorName} inspected ${owner.name}'s ${item.name} without permission.`;
    return `${actorName} used ${owner.name}'s ${fixture.name} without permission.`;
  };
  return { details, describe };
}
/** Synchronous palace rules and rendering. No model calls or narrative state. */
export class PalaceMechanics {
  #scenario: Scenario;
  #npcActivities: Record<string, NpcActivity>;
  #conversations;
  #conversationReplyOptions;
  #conversationEndRequested;
  constructor(scenario: Scenario, activity: MechanicalActivity) {
    this.#scenario = scenario;
    this.#npcActivities = structuredClone(activity.npcActivities ?? {});
    this.#conversations = new Map(Object.entries(activity.conversations).map(([id, turns]) => [id, turns.map(turn => fromJson(TranscriptMessageSchema, turn))]));
    this.#conversationReplyOptions = activity.conversationReplyOptions ?? {};
    this.#conversationEndRequested = activity.conversationEndRequested ?? {};
  }
  snapshot() {
    return { scenario: toJson(ScenarioSchema, this.#scenario), npcActivities: this.#npcActivities };
  }
  #setScenario(scenario: Scenario) { this.#scenario = scenario; }
  worldEvent(kind: string, summary: string, participantIds: string[], details: EventDetails = {}): Event {
    return createPhysicalEvent(this.#scenario.world, kind, summary, participantIds, details);
  }

  stepNpcAction(characterId: string, actionId: string, goal: string): { done: boolean; talkTarget?: string; worldEvent?: Event } {
    const scenario = this.#scenario, activity = this.#npcActivities[characterId];
    if (activity?.status !== "active" || activity.reviewPending || this.#conversations.get(characterId)?.length) throw new Error("NPC paused for conversation.");
    const observation = courtAgentObservation(scenario, characterId, actionId);
    const action = observation.actions.find(item => item.id === actionId);
    if (observation.goal !== goal || !action) throw new Error("Action changed; replan.");
    if (action.path.length <= 2 && action.type !== "talk") {
      const context = action.type === "fixture" ? fixtureEventContext(scenario, characterId, actionId) : { details: {} as EventDetails };
      const message = this.executeNpcAction(characterId, actionId, observation.revision, goal);
      const name = scenario.characters.find(character => character.id === characterId)?.name ?? characterId;
      return { done: true,
        worldEvent: this.worldEvent(action.type, context.describe?.(name, message) ?? `${name}: ${message}`, [characterId], context.details) };
    }
    const next = action.path[1];
    if (next) {
      const actor = scenario.world!.actors.find(a => a.characterId === characterId)!;
      actor.position = create(TilePositionSchema, next); actor.roomId = courtRoomAt(next)?.id ?? actor.roomId;
      scenario.world!.revision++; this.#setScenario(scenario);
    }
    return { ...(action.type === "talk" && action.path.length <= 2 ? { done: true, talkTarget: action.target } : { done: false }) };
  }

  executeNpcAction(characterId: string, actionId: string, revision: number, goal: string): string {
    const scenario = this.#scenario, world = scenario.world!;
    const activity = this.#npcActivities[characterId];
    if (activity?.status !== "active" || activity.reviewPending || activity.history.length >= 24) throw new Error("NPC is not accepting actions.");
    if (world.phase !== GamePhase.CONVERSATIONS || world.revision !== revision || this.#conversations.get(characterId)?.length) throw new Error("World changed; replan before acting.");
    const observation = courtAgentObservation(scenario, characterId, actionId);
    if (observation.goal !== goal) throw new Error("Goal changed; replan before acting.");
    const action = observation.actions.find(item => item.id === actionId);
    if (!action) throw new Error("That NPC action is no longer available.");
    if (action.type === "talk") throw new Error("Talk requires conversation resolution.");
    const actor = world.actors.find(actor => actor.characterId === characterId)!;
    const destination = action.path.at(-1)!;
    if (action.type === "door" && !action.open && world.actors.some(other => other.characterId !== characterId && other.position && world.doors.find(door => door.id === action.target)!.tiles.some(tile => tile.x === other.position!.x && tile.y === other.position!.y))) throw new Error("Someone is standing in the doorway.");
    actor.position = create(TilePositionSchema, destination);
    actor.roomId = courtRoomAt(destination)?.id ?? actor.roomId;
    let message = action.description;
    if (action.type === "door") world.doors.find(door => door.id === action.target)!.open = action.open!;
    if (action.type === "fixture") message = applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), characterId, action.id);
    world.revision++; this.#setScenario(scenario);
    activity.history.push(message);
    (activity.actionIds ??= []).push(action.id);
    npcLog.info("NPC action executed", { characterId, actionId, goal, message, revision: world.revision });
    return message;
  }

  finishNpcRun(characterId: string, reason: NonNullable<NpcActivity["result"]>["reason"], detail: string): void {
    const activity = this.#npcActivities[characterId];
    if (!activity || activity.status !== "active") throw new Error("NPC has no active run to finish.");
    if (!["complete", "unable", "wait", "error", "limit", "cancelled"].includes(reason)) throw new Error("Invalid termination reason.");
    activity.status = "idle";
    activity.result = { reason, detail: detail.slice(0, 2000) };
    npcLog.info("NPC activity stopped", { characterId, reason });
    activity.reviewPending = true;
  }

  interactFixture(actionId: string): string {
    const scenario = this.#scenario, world = scenario.world;
    if (world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter court before interacting with furniture.");
    const actorId = scenario.playerCharacterId!;
    const action = fixtureActions(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), actorId).find(item => item.id === actionId);
    if (!action) throw new Error("That furniture action is no longer available. Open the action menu again.");
    const fixture = world.fixtures.find(item => item.id === action.target);
    const position = world.actors.find(actor => actor.characterId === actorId)?.position;
    if (action?.target === actorId && action.itemId) {
      const result = applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), actorId, actionId);
      world.revision++; this.#setScenario(scenario);
      return result;
    }
    if (!fixture?.position || !position) throw new Error("Unknown furniture interaction.");
    const spot = fixture.interactionSpot;
    if (spot ? position.x !== spot.x || position.y !== spot.y
      : Math.abs(position.x - fixture.position.x) + Math.abs(position.y - fixture.position.y) !== 1) {
      throw new Error("Walk to the furniture's interaction spot first.");
    }
    const result = applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), actorId, actionId);
    world.revision++;
    this.#setScenario(scenario);
    return result;
  }

  interactFixtureWithEvent(actionId: string): { message: string; event: Event } {
    const scenario = this.#scenario, actorId = scenario.playerCharacterId!;
    const name = scenario.characters.find(character => character.id === actorId)?.name ?? actorId;
    const context = fixtureEventContext(scenario, actorId, actionId);
    const message = this.interactFixture(actionId);
    return { message, event: this.worldEvent("interacting with an object", context.describe?.(name, message) ?? `${name}: ${message}`, [actorId], context.details) };
  }

}
