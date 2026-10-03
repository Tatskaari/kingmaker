import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ScenarioSchema, TranscriptMessageSchema, TranscriptRole, TilePositionSchema, DndCharacterSchema, EventSchema, GamePhase, type Scenario, type Event } from "../../../packages/contracts/src/index.js";
import { GenerationStore, generationIds, type Generations, type ExpectedGenerations } from "../../../packages/core/src/generations.js";
import { fixtureActions, applyFixtureAction } from "../../../packages/core/src/fixtures.js";
import { findItem, itemsFor } from "../../../packages/core/src/inventory.js";
import { worldForCharacter } from "../../../packages/core/src/context.js";
import { stateResources } from "./state-resources.js";
import { courtAgentObservation, actionResourceIds } from "./court-agent.js";
import { courtPath, courtRoomAt } from "./court-map.js";
import type { Point } from "./navigation.js";
import { gameLogger } from "../../../packages/observability/src/logging.js";
const npcLog = gameLogger("npc"), eventLog = gameLogger("events");
type JsonObject = Record<string, unknown>;
type EventDetails = Record<string, JsonValue>;
export interface NpcActivity {
  status: "idle" | "active";
  goal: string;
  history: string[];
  /** Exact completed action IDs for the text planner; older saves may omit these. */
  actionIds?: string[];
  result?: { reason: "complete" | "unable" | "wait" | "error" | "limit" | "cancelled"; detail: string };
  reviewPending?: boolean;
}

export interface MechanicalActivity {
  generations?: Generations;
  npcActivities?: Record<string, NpcActivity>;
  conversations: Record<string, JsonValue[]>;
  conversationReplyOptions?: Record<string, string[]>;
  conversationEndRequested?: Record<string, boolean>;
}
function fixtureEventContext(scenario: Scenario, actorId: string, actionId: string) {
  const action = fixtureActions(scenario, actorId).find(candidate => candidate.id === actionId);
  if (!action || action.target === actorId) return { details: {} as EventDetails };
  const fixture = scenario.world?.fixtures.find(candidate => candidate.id === action.target);
  const item = findItem(scenario, action.itemId ?? "");
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
  #generations: GenerationStore;
  #npcActivities: Record<string, NpcActivity>;
  #conversations;
  #conversationReplyOptions;
  #conversationEndRequested;
  constructor(scenario: Scenario, activity: MechanicalActivity) {
    this.#scenario = scenario;
    this.#generations = new GenerationStore(activity.generations);
    this.#npcActivities = structuredClone(activity.npcActivities ?? {});
    this.#conversations = new Map(Object.entries(activity.conversations).map(([id, turns]) => [id, turns.map(turn => fromJson(TranscriptMessageSchema, turn))]));
    this.#conversationReplyOptions = activity.conversationReplyOptions ?? {};
    this.#conversationEndRequested = activity.conversationEndRequested ?? {};
  }
  snapshot() {
    this.readResources();
    return { scenario: toJson(ScenarioSchema, this.#scenario), generations: this.#generations.snapshot(), npcActivities: this.#npcActivities };
  }
  #resources() {
    return stateResources(this.#scenario, this.#npcActivities,
      Object.fromEntries([...this.#conversations].map(([id, messages]) => [id, {
        messages, replies: this.#conversationReplyOptions[id], ended: this.#conversationEndRequested[id],
      }])));
  }

  readResources(keys?: string[]) { return this.#generations.read(this.#resources(), keys); }

  #guardPhysical(keys: string[], expected?: ExpectedGenerations) {
    const supplied = expected ? Object.fromEntries(keys.map(key => [key, expected[key]!])) : generationIds(this.readResources(keys));
    this.#generations.check(this.#resources(), supplied, keys);
  }

  #setScenario(scenario: Scenario) { this.#scenario = scenario; this.readResources(); }
  movePlayer(destination: Point, expected?: ExpectedGenerations): void {
    const scenario = this.#scenario, world = scenario.world;
    if (world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter the court before walking around.");
    this.#guardPhysical(["world:context", `actor:${scenario.playerCharacterId}`, ...world.doors.map(door => `door:${door.id}`)], expected);
    const player = scenario.characters.find(character => character.id === scenario.playerCharacterId);
    const actor = world.actors.find(actor => actor.characterId === player?.id);
    if (!player || !actor) throw new Error("Player is missing from the palace.");
    const start = actor.position;
    if (!start || !courtPath(start, destination, world.doors, world.fixtures)) throw new Error("That destination is not reachable.");
    const room = courtRoomAt(destination);
    if (!room) throw new Error("That destination is outside the palace.");
    if (!world.rooms.some(existing => existing.id === room.id)) throw new Error("Destination room is missing from the authored world.");
    actor.roomId = room.id; world.revision++;
    actor.position = create(TilePositionSchema, destination);
    this.#setScenario(scenario);
  }

  worldEvent(kind: string, summary: string, participantIds: string[], details: EventDetails = {}): Event {
    const scenario = this.#scenario;
    const actor = scenario.world?.actors.find(candidate => candidate.characterId === participantIds[0]);
    const event = create(EventSchema, { id: `event-${crypto.randomUUID()}`, day: scenario.world?.day ?? 0,
      kind, summary, participantIds, position: actor?.position, details });
    eventLog.info("World event created", { eventId: event.id, day: event.day, kind, summary, participantIds, position: event.position, details });
    return event;
  }

  stepNpcAction(characterId: string, actionId: string, goal: string, expected?: ExpectedGenerations): { done: boolean; talkTarget?: string; worldEvent?: Event; generations: ExpectedGenerations } {
    const scenario = this.#scenario, activity = this.#npcActivities[characterId];
    if (activity?.status !== "active" || activity.reviewPending || this.#conversations.get(characterId)?.length) throw new Error("NPC paused for conversation.");
    const observation = courtAgentObservation(scenario, characterId, actionId);
    const action = observation.actions.find(item => item.id === actionId);
    const keys = actionResourceIds(scenario, characterId, action);
    if (expected) this.#generations.check(this.#resources(), expected, keys);
    if (observation.goal !== goal || !action) throw new Error("Action changed; replan.");
    if (action.path.length <= 2 && action.type !== "talk") {
      const context = action.type === "fixture" ? fixtureEventContext(scenario, characterId, actionId) : { details: {} as EventDetails };
      const message = this.executeNpcAction(characterId, actionId, observation.revision, goal);
      const name = scenario.characters.find(character => character.id === characterId)?.name ?? characterId;
      return { done: true, generations: generationIds(this.readResources(keys)),
        worldEvent: this.worldEvent(action.type, context.describe?.(name, message) ?? `${name}: ${message}`, [characterId], context.details) };
    }
    const next = action.path[1];
    if (next) {
      const actor = scenario.world!.actors.find(a => a.characterId === characterId)!;
      actor.position = create(TilePositionSchema, next); actor.roomId = courtRoomAt(next)?.id ?? actor.roomId;
      scenario.world!.revision++; this.#setScenario(scenario);
    }
    return { ...(action.type === "talk" && action.path.length <= 2 ? { done: true, talkTarget: action.target } : { done: false }),
      generations: generationIds(this.readResources(keys)) };
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
    if (action.type === "fixture") message = applyFixtureAction(scenario, characterId, action.id);
    world.revision++; this.#setScenario(scenario);
    activity.history.push(message);
    (activity.actionIds ??= []).push(action.id);
    npcLog.info("NPC action executed", { characterId, actionId, goal, message, revision: world.revision });
    return message;
  }

  finishNpcRun(characterId: string, reason: NonNullable<NpcActivity["result"]>["reason"], detail: string, expected?: ExpectedGenerations): void {
    this.readResources();
    if (expected) this.#generations.check(this.#resources(), expected, [`character:${characterId}`]);
    const activity = this.#npcActivities[characterId];
    if (!activity || activity.status !== "active") throw new Error("NPC has no active run to finish.");
    if (!["complete", "unable", "wait", "error", "limit", "cancelled"].includes(reason)) throw new Error("Invalid termination reason.");
    activity.status = "idle";
    activity.result = { reason, detail: detail.slice(0, 2000) };
    npcLog.info("NPC activity stopped", { characterId, reason });
    activity.reviewPending = true;
    this.readResources();
  }

  interactFixture(actionId: string, expected?: ExpectedGenerations): string {
    const scenario = this.#scenario, world = scenario.world;
    if (world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter court before interacting with furniture.");
    const actorId = scenario.playerCharacterId!;
    const action = fixtureActions(scenario, actorId).find(item => item.id === actionId);
    this.#guardPhysical(["world:context", `actor:${actorId}`, `inventory:${actorId}`,
      ...(action && action.target !== actorId ? [`fixture:${action.target}`, `inventory:${action.target}`] : []),
      ...(action?.itemId ? [`item:${action.itemId}`] : [])], expected);
    const fixture = world.fixtures.find(item => item.id === action?.target);
    const position = world.actors.find(actor => actor.characterId === actorId)?.position;
    if (action?.target === actorId && action.itemId) {
      const result = applyFixtureAction(scenario, actorId, actionId);
      world.revision++; this.#setScenario(scenario);
      return result;
    }
    if (!fixture?.position || !position) throw new Error("Unknown furniture interaction.");
    const spot = fixture.interactionSpot;
    if (spot ? position.x !== spot.x || position.y !== spot.y
      : Math.abs(position.x - fixture.position.x) + Math.abs(position.y - fixture.position.y) !== 1) {
      throw new Error("Walk to the furniture's interaction spot first.");
    }
    const result = applyFixtureAction(scenario, actorId, actionId);
    world.revision++;
    this.#setScenario(scenario);
    return result;
  }

  interactFixtureWithEvent(actionId: string, expected?: ExpectedGenerations): { message: string; event: Event } {
    const scenario = this.#scenario, actorId = scenario.playerCharacterId!;
    const name = scenario.characters.find(character => character.id === actorId)?.name ?? actorId;
    const context = fixtureEventContext(scenario, actorId, actionId);
    const message = this.interactFixture(actionId, expected);
    return { message, event: this.worldEvent("interacting with an object", context.describe?.(name, message) ?? `${name}: ${message}`, [actorId], context.details) };
  }

  setDoor(id: string, open: boolean, expected?: ExpectedGenerations): Event {
    const scenario = this.#scenario, world = scenario.world;
    if (world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter the court before using doors.");
    this.#guardPhysical(["world:context", `actor:${scenario.playerCharacterId}`, `door:${id}`, `doorway:${id}`], expected);
    const door = world.doors.find(door => door.id === id);
    const player = world.actors.find(actor => actor.characterId === scenario.playerCharacterId);
    if (!door || door.open === open || !player?.position || !door.interactionSpots.some(spot => spot.x === player.position!.x && spot.y === player.position!.y)) {
      throw new Error("Walk to a door interaction spot before using it.");
    }
    if (!open && world.actors.some(actor => actor.position && door.tiles.some(tile => tile.x === actor.position!.x && tile.y === actor.position!.y))) {
      throw new Error("Someone is standing in the doorway.");
    }
    door.open = open; world.revision++; this.#setScenario(scenario);
    const playerName = scenario.characters.find(character => character.id === scenario.playerCharacterId)?.name ?? "The player";
    return this.worldEvent("using a door", `${playerName} ${open ? "opened" : "closed"} ${door.name}.`, [scenario.playerCharacterId!]);
  }

  view(): JsonObject {
    const scenario = this.#scenario;
    const world = scenario.world;
    const player = scenario.characters.find(character => character.id === scenario.playerCharacterId);
    return {
      playerMessages: scenario.notes.filter(note => note.details?.kind === "player_message" && note.characterIds.includes(scenario.playerCharacterId ?? ""))
        .map(({ id, day, text, details }) => ({ id, day, message: text,
          ...(typeof details?.createdAt === "string" ? { createdAt: details.createdAt } : {}) })),
      revision: world?.revision ?? 0,
      generations: generationIds(this.readResources(["world:context", `actor:${scenario.playerCharacterId}`, `inventory:${scenario.playerCharacterId}`,
        ...(world?.doors.flatMap(door => [`door:${door.id}`, `doorway:${door.id}`]) ?? []),
        ...(world?.fixtures.flatMap(fixture => [`fixture:${fixture.id}`, `inventory:${fixture.id}`]) ?? []),
        ...(world ? worldForCharacter(scenario, scenario.playerCharacterId ?? "").objects.map(item => `item:${item.id}`) : [])])),
      npcActivities: Object.fromEntries(scenario.characters.filter(item => item.id !== scenario.playerCharacterId).map(item => [item.id, this.#npcActivities[item.id] ?? { status: "idle", goal: item.currentGoal, history: [] }])),
      phase: "conversations",
      day: world?.day || 0,
      doors: world?.doors ?? [],
      fixtures: world ? worldForCharacter(scenario, scenario.playerCharacterId ?? "").fixtures : [],
      fixtureActions: fixtureActions(scenario, scenario.playerCharacterId ?? ""),
      inventory: itemsFor(scenario, scenario.playerCharacterId ?? "").map(({ id, name, details }) => ({ id, name, details })),
      roomAccess: world?.rooms.map(({ id, private: restricted, allowedCharacterIds }) => ({ id, private: restricted, allowedCharacterIds })) ?? [],
      location: world?.rooms.find(room => room.id === world.actors.find(actor => actor.characterId === player?.id)?.roomId)?.name || "Great Hall",
      premise: scenario.premise,
      player: player ? {
        dnd: player.dnd ? toJson(DndCharacterSchema, player.dnd, { alwaysEmitImplicit: true }) : null,
        id: player.id, name: player.name, gender: player.gender, delegation: player.delegation, sprite: player.sprite, position: world?.actors.find(actor => actor.characterId === player.id)?.position, roomId: world?.actors.find(actor => actor.characterId === player.id)?.roomId, lore: player.lore, currentGoal: player.currentGoal,
        relationships: player.relationships.map(relationship => ({
          characterId: relationship.characterId,
          characterName: scenario.characters.find(character => character.id === relationship.characterId)?.name || relationship.characterId,
          description: relationship.description,
        })),
      } : null,
      characters: scenario.characters.filter(character => character.id !== "player").map(character => ({ id: character.id, name: character.name, dialogueObjectives: character.dialogueObjectives, activeObjective: character.activeObjective, currentGoal: character.currentGoal, position: world?.actors.find(actor => actor.characterId === character.id)?.position, roomId: world?.actors.find(actor => actor.characterId === character.id)?.roomId })),
      conversationReplyOptions: this.#conversationReplyOptions,
      conversationEndRequested: this.#conversationEndRequested,
      conversations: Object.fromEntries([...this.#conversations].map(([id, transcript]) => [id, transcript.filter(message => message.role !== TranscriptRole.GAME_MASTER).map(message => ({
        role: message.role === TranscriptRole.CHARACTER ? "character" : "player", text: message.text,
      }))])),
    };
  }

}
