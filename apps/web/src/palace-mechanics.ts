import { recordCharacterHistory, type CharacterHistory } from "../../../packages/core/src/character-history.js";
import { interactWithFixture } from "../../../packages/core/src/simulation-fixtures.js";
import { doorError, setDoor } from "../../../packages/core/src/simulation-doors.js";
import { actorPosition, mapAtTime } from "../../../packages/core/src/simulation-movement.js";
import { executeLocalMove } from "../../../packages/core/src/local-move-executor.js";
import { createPhysicalEvent } from "./physical-event.js";
import { create, type JsonValue } from "@bufbuild/protobuf";
import { GamePhase, type MapState as PhysicalMap, type Event } from "../../../packages/contracts/src/index.js";
import { fixtureActions, fixtureActionMessage } from "../../../packages/core/src/fixtures.js";
import { inventoryOwners, findItem } from "../../../packages/core/src/inventory.js";
import { type WorldState, type SimulationState } from "../../../packages/contracts/src/v2.js";
import { characterDocuments } from "../../../packages/lore/src/character-id.js";
import { activityGoal } from "../../../packages/lore/src/activity.js";
import type { SimulationMove } from "../../../packages/core/src/simulation-move.js";
import { roomAgentActions } from "./room-actions.js";

import { gameLogger } from "../../../packages/observability/src/logging.js";
import { rollD20 } from "../../../packages/core/src/ability-checks.js";
import { cartStrengthCheck, type CartStrengthCheck } from "../../../packages/core/src/cart.js";
function mechanicalCharacters(world: WorldState, simulation: () => SimulationState) {
  return characterDocuments(world).map(({ id, path, document }) => ({ id, path,
    name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
    currentGoal: id === "player" ? "" : activityGoal(world, id) ?? "",
    get character() { return simulation().runtimeCharacters[id]!; },
    get inventory() { return simulation().runtimeCharacters[id]!.inventory; },
  }));
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

export interface MechanicalActivity extends CharacterHistory {
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
    if (action.verb === "smash") return `${actorName}: ${fallback}${illegalDestruction()}`;
    if (action.legality !== "illegal" || !owner || !fixture) return `${actorName}: ${fallback}`;
    if (action.verb === "take" && item) return `${actorName} stole ${item.name} from ${owner.name}'s ${fixture.name}.`;
    if (action.verb === "open") return `${actorName} opened ${owner.name}'s ${fixture.name} without permission. ${fallback}`;
    if (action.verb === "inspect" && item) return `${actorName} inspected ${owner.name}'s ${item.name} without permission.`;
    return `${actorName} used ${owner.name}'s ${fixture.name} without permission.`;
  };
  const illegalDestruction = () => action.legality === "illegal" && owner ? ` The cart belongs to ${owner.name}.` : "";
  return { details, describe };
}
/** Synchronous rules over a live document world's mechanical state. */
export class PalaceMechanics {
  get #world(): PhysicalMap { return this.#simulation.map!; }
  #simulation: SimulationState;
  #characters;
  #playerId: string;
  #npcActivities: Record<string, NpcActivity>;
  #conversations: MechanicalActivity["conversations"];
  constructor(world: WorldState, private readonly activity: MechanicalActivity, private readonly now = () => Date.now(),
    private readonly authority?: {
      currentSimulation(): SimulationState;
      executeMove<Args extends unknown[]>(move: SimulationMove<Args>, ...args: Args): void;
    }, private readonly rollFixtureDie = rollD20) {
    if (!world.simulation!.map) throw new Error("A physical map is required.");
    this.#simulation = world.simulation!;
    this.#characters = mechanicalCharacters(world, () => this.#simulation);
    this.#playerId = world.player ? "player" : "";
    this.#npcActivities = activity.npcActivities ??= {};
    this.#conversations = activity.conversations;
  }
  result() {
    return { map: this.#world, characters: Object.fromEntries(this.#characters.map(character => [character.id, character.character])),
      npcActivities: this.#npcActivities };
  }
  private executeMove<Args extends unknown[]>(move: SimulationMove<Args>, ...args: Args) {
    if (this.authority) {
      this.authority.executeMove(move, ...args);
      this.#simulation = this.authority.currentSimulation();
    } else this.#simulation = executeLocalMove(this.#simulation, move, ...args);
  }
  private applyFixture(actorId: string, actionId: string, natural?: number): string {
    const message = fixtureActionMessage(this.#simulation, actorId, actionId, natural);
    this.executeMove(interactWithFixture, actorId, actionId, this.now(), natural);
    return message;
  }
  private observe(characterId: string, continuingActionId: string) {
    if (characterId === this.#playerId) throw new Error("NPC observation requires an NPC.");
    const character = this.#characters.find(character => character.id === characterId);
    if (!character || !this.#world.actors.some(actor => actor.characterId === characterId && actor.position)) throw new Error("Character is not placed in the palace.");
    return { goal: character.currentGoal, revision: this.#world.revision,
      actions: roomAgentActions(mapAtTime(this.#world, this.now()), this.#characters, inventoryOwners(this.#characters, this.#world), characterId, continuingActionId) };
  }
  worldEvent(kind: string, summary: string, participantIds: string[], details: EventDetails = {}): Event {
    return createPhysicalEvent(mapAtTime(this.#world, this.now()), kind, summary, participantIds, details);
  }

  prepareNpcAction(characterId: string, actionId: string, goal: string) {
    const activity = this.#npcActivities[characterId];
    if (activity?.status !== "active" || activity.reviewPending || this.#conversations[characterId]?.length) throw new Error("NPC paused for conversation.");
    const observation = this.observe(characterId, actionId);
    const action = observation.actions.find(item => item.id === actionId);
    if (observation.goal !== goal || !action) throw new Error("Action changed; replan.");
    const actor = this.#world.actors.find(actor => actor.characterId === characterId)!;
    return { action, actorId: actor.instanceId || characterId, roomId: actor.roomId };
  }

  stepNpcAction(characterId: string, actionId: string, goal: string): { done: boolean; talkTarget?: string; worldEvent?: Event } {
    const { action } = this.prepareNpcAction(characterId, actionId, goal);
    if (action.path.length > 1) throw new Error("Actor has not arrived; replan.");
    if (action.type === "talk") return { done: true, talkTarget: action.target };
    const context = action.type === "fixture" ? fixtureEventContext(this.#world, this.#characters, characterId, actionId) : { details: {} as EventDetails };
    const message = this.executeNpcAction(characterId, actionId, this.#world.revision, goal);
    const name = this.#characters.find(character => character.id === characterId)?.name ?? characterId;
    return { done: true, worldEvent: this.worldEvent(action.type, context.describe?.(name, message) ?? `${name}: ${message}`, [characterId], context.details) };
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
    if (action.path.length > 1) throw new Error("Actor has not arrived; replan.");
    let message = action.description;
    if (action.type === "door") {
      const atMs = this.now(), error = doorError(this.#simulation, characterId, action.target, action.open!, atMs);
      if (error) throw new Error(error);
      this.executeMove(setDoor, characterId, action.target, action.open!, atMs);
    } else {
      if (action.type === "fixture") message = this.applyFixture(characterId, action.id);
    }
    recordCharacterHistory(this.activity, characterId, { kind: "action", id: action.id, text: `${action.id}: ${message}` });
    activity.history.push(message);
    (activity.actionIds ??= []).push(action.id);
    npcLog.info("NPC action executed", { characterId, actionId, goal, message, revision: this.#world.revision });
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

  interactFixture(actionId: string): { message: string; roll?: CartStrengthCheck } {
    const world = this.#world, characters = this.#characters;
    if (world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter court before interacting with furniture.");
    const actorId = this.#playerId;
    const action = fixtureActions(world.fixtures, inventoryOwners(characters, world), actorId).find(item => item.id === actionId);
    if (!action) throw new Error("That furniture action is no longer available. Open the action menu again.");
    const fixture = world.fixtures.find(item => item.id === action.target);
    const position = actorPosition(world.actors.find(actor => actor.characterId === actorId), this.now());
    if (action?.target === actorId && action.itemId) {
      const result = this.applyFixture( actorId, actionId);
      return { message: result };
    }
    if (!fixture?.position || !position) throw new Error("Unknown furniture interaction.");
    const spot = fixture.interactionSpot;
    if (spot ? position.x !== spot.x || position.y !== spot.y
      : Math.abs(position.x - fixture.position.x) + Math.abs(position.y - fixture.position.y) !== 1) {
      throw new Error("Walk to the furniture's interaction spot first.");
    }
    const roll = action.verb === "smash" ? cartStrengthCheck(this.#simulation.runtimeCharacters[actorId]?.dnd, this.rollFixtureDie()) : undefined;
    const message = this.applyFixture(actorId, actionId, roll?.roll);
    return { message, ...(roll ? { roll } : {}) };
  }

  interactFixtureWithEvent(actionId: string): { message: string; event: Event; roll?: CartStrengthCheck } {
    const world = this.#world, characters = this.#characters, actorId = this.#playerId;
    const name = characters.find(character => character.id === actorId)?.name ?? actorId;
    const context = fixtureEventContext(world, characters, actorId, actionId);
    const result = this.interactFixture(actionId);
    return { ...result, event: this.worldEvent("interacting with an object", context.describe?.(name, result.message) ?? `${name}: ${result.message}`, [actorId],
      { ...context.details, ...(result.roll ? { strengthCheck: { ...result.roll } } : {}) }) };
  }

}
