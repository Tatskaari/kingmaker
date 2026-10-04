import { createPhysicalEvent } from "./physical-event.js";
import { create, type JsonValue } from "@bufbuild/protobuf";
import { TilePositionSchema, GamePhase, type WorldState as PhysicalMap, type Event } from "../../../packages/contracts/src/index.js";
import { fixtureActions, applyFixtureAction } from "../../../packages/core/src/fixtures.js";
import { inventoryOwners, findItem } from "../../../packages/core/src/inventory.js";
import { CharacterPropertiesSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { characterDocuments } from "../../../packages/lore/src/character-id.js";
import { activityGoal } from "../../../packages/lore/src/activity.js";
import { foregroundBodies } from "./background-characters.js";
import { roomAgentActions } from "./room-actions.js";

import { courtRoomAt } from "./court-map.js";
import { gameLogger } from "../../../packages/observability/src/logging.js";
function mechanicalCharacters(world: WorldState) {
  return characterDocuments(world).map(({ id, path, document }) => ({ id, path,
    name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
    currentGoal: activityGoal(world, id) ?? "",
    properties: document.characterProperties, inventory: document.characterProperties?.inventory }));
}
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
function fixtureEventContext(world: PhysicalMap, characters: ReturnType<typeof mechanicalCharacters>, actorId: string, actionId: string) {
  const action = fixtureActions(world.fixtures, inventoryOwners(characters, world), actorId).find(candidate => candidate.id === actionId);
  if (!action || action.target === actorId) return { details: {} as EventDetails };
  const fixture = world.fixtures.find(candidate => candidate.id === action.target);
  const item = findItem(inventoryOwners(characters, world), action.itemId ?? "");
  const owner = characters.find(character => character.id === fixture?.ownerCharacterId);
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
/** Synchronous rules over a detached document world's mechanical state. */
export class PalaceMechanics {
  #world: PhysicalMap;
  #characters;
  #playerId: string;
  #npcActivities: Record<string, NpcActivity>;
  #conversations: MechanicalActivity["conversations"];
  constructor(world: WorldState, activity: MechanicalActivity) {
    if (!world.map) throw new Error("A physical map is required.");
    this.#world = world.map;
    this.#world.actors = foregroundBodies(this.#world.actors);
    this.#characters = mechanicalCharacters(world);
    this.#playerId = world.player ? "player" : "";
    this.#npcActivities = structuredClone(activity.npcActivities ?? {});
    this.#conversations = activity.conversations;
  }
  snapshot() {
    return { map: this.#world, properties: Object.fromEntries(this.#characters.map(character => [character.path,
      create(CharacterPropertiesSchema, { ...character.properties, inventory: character.inventory })])),
      npcActivities: this.#npcActivities };
  }
  private observe(characterId: string, continuingActionId: string) {
    if (characterId === this.#playerId) throw new Error("NPC observation requires an NPC.");
    const character = this.#characters.find(character => character.id === characterId);
    if (!character || !this.#world.actors.some(actor => actor.characterId === characterId && actor.position)) throw new Error("Character is not placed in the palace.");
    return { goal: character.currentGoal, revision: this.#world.revision,
      actions: roomAgentActions(this.#world, this.#characters, inventoryOwners(this.#characters, this.#world), characterId, continuingActionId) };
  }
  worldEvent(kind: string, summary: string, participantIds: string[], details: EventDetails = {}): Event {
    return createPhysicalEvent(this.#world, kind, summary, participantIds, details);
  }

  stepNpcAction(characterId: string, actionId: string, goal: string): { done: boolean; talkTarget?: string; worldEvent?: Event } {
    const world = this.#world, characters = this.#characters, activity = this.#npcActivities[characterId];
    if (activity?.status !== "active" || activity.reviewPending || this.#conversations[characterId]?.length) throw new Error("NPC paused for conversation.");
    const observation = this.observe(characterId, actionId);
    const action = observation.actions.find(item => item.id === actionId);
    if (observation.goal !== goal || !action) throw new Error("Action changed; replan.");
    if (action.path.length <= 2 && action.type !== "talk") {
      const context = action.type === "fixture" ? fixtureEventContext(world, characters, characterId, actionId) : { details: {} as EventDetails };
      const message = this.executeNpcAction(characterId, actionId, observation.revision, goal);
      const name = characters.find(character => character.id === characterId)?.name ?? characterId;
      return { done: true,
        worldEvent: this.worldEvent(action.type, context.describe?.(name, message) ?? `${name}: ${message}`, [characterId], context.details) };
    }
    const next = action.path[1];
    if (next) {
      const actor = world.actors.find(a => a.characterId === characterId)!;
      actor.position = create(TilePositionSchema, next); actor.roomId = courtRoomAt(next)?.id ?? actor.roomId;
      world.revision++;
    }
    return { ...(action.type === "talk" && action.path.length <= 2 ? { done: true, talkTarget: action.target } : { done: false }) };
  }

  executeNpcAction(characterId: string, actionId: string, revision: number, goal: string): string {
    const world = this.#world, characters = this.#characters;
    const activity = this.#npcActivities[characterId];
    if (activity?.status !== "active" || activity.reviewPending || activity.history.length >= 24) throw new Error("NPC is not accepting actions.");
    if (world.phase !== GamePhase.CONVERSATIONS || world.revision !== revision || this.#conversations[characterId]?.length) throw new Error("World changed; replan before acting.");
    const observation = this.observe(characterId, actionId);
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
    if (action.type === "fixture") message = applyFixtureAction(world.fixtures, inventoryOwners(characters, world), characterId, action.id);
    world.revision++;
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
    const world = this.#world, characters = this.#characters;
    if (world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter court before interacting with furniture.");
    const actorId = this.#playerId;
    const action = fixtureActions(world.fixtures, inventoryOwners(characters, world), actorId).find(item => item.id === actionId);
    if (!action) throw new Error("That furniture action is no longer available. Open the action menu again.");
    const fixture = world.fixtures.find(item => item.id === action.target);
    const position = world.actors.find(actor => actor.characterId === actorId)?.position;
    if (action?.target === actorId && action.itemId) {
      const result = applyFixtureAction(world.fixtures, inventoryOwners(characters, world), actorId, actionId);
      world.revision++;
      return result;
    }
    if (!fixture?.position || !position) throw new Error("Unknown furniture interaction.");
    const spot = fixture.interactionSpot;
    if (spot ? position.x !== spot.x || position.y !== spot.y
      : Math.abs(position.x - fixture.position.x) + Math.abs(position.y - fixture.position.y) !== 1) {
      throw new Error("Walk to the furniture's interaction spot first.");
    }
    const result = applyFixtureAction(world.fixtures, inventoryOwners(characters, world), actorId, actionId);
    world.revision++;
    return result;
  }

  interactFixtureWithEvent(actionId: string): { message: string; event: Event } {
    const world = this.#world, characters = this.#characters, actorId = this.#playerId;
    const name = characters.find(character => character.id === actorId)?.name ?? actorId;
    const context = fixtureEventContext(world, characters, actorId, actionId);
    const message = this.interactFixture(actionId);
    return { message, event: this.worldEvent("interacting with an object", context.describe?.(name, message) ?? `${name}: ${message}`, [actorId], context.details) };
  }

}
