import { createMovementService, type MovementClock } from "../../../packages/core/src/movement-service.js";
import { getActorPosition, mapAtTime } from "../../../packages/core/src/simulation-movement.js";
import { roomAt } from "../../../packages/core/src/pathfinding.js";
import { refreshDocumentGraph } from "../../../packages/lore/src/world-state.js";
import { validateDocuments } from "../../../packages/lore/src/document-audit.js";
import { doorError, setDoor } from "../../../packages/core/src/simulation-doors.js";
import { worldView } from "./world-view.js";
import { createPhysicalEvent } from "./physical-event.js";
import { inventoryOwners } from "../../../packages/core/src/inventory.js";
import { strangerEntry } from "./stranger-lore.js";
import { creationAffiliations } from "./stranger-draft.js";
import type { StrangerState } from "./stranger-interview.js";
import { GamePhase, WorldMapSchema } from "../../../packages/contracts/src/index.js";
import type { MapService } from "../../../packages/conversation/src/map.js";
import { roomAgentActions } from "./room-actions.js";
import { foregroundBodies } from "./background-characters.js";
import { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import { clone, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { type Event } from "../../../packages/contracts/src/index.js";
import { DocumentSchema, RuntimeCharacterSchema, WorldStateSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { createScenarioServices } from "../../../packages/lore/src/services.js";
import { activityGoal, characterIntent, formatActivity } from "../../../packages/lore/src/activity.js";
import { PalaceMechanics, type MechanicalActivity } from "./palace-mechanics.js";
import { characterDocuments, characterId } from "../../../packages/lore/src/character-id.js";
import type { Point } from "../../../packages/core/src/navigation.js";

export type WorldSnapshot = MechanicalActivity & {
  stranger?: StrangerState;
  jail?: { characterId: string; message: string };
  arrestChallenges?: Record<string, boolean>;
  pendingConversationEvents?: Record<string, JsonValue>;
  pendingWaitReviews?: Record<string, { instructions: string; observation: string }>;
  version: 8; world: JsonValue;
  playerMessages: Array<{ id: string; day: number; message: string; createdAt: string; conversationTitle?: string }>;
};

/** Documents and mechanics have one authority; synchronous actions operate on live mechanical state. */
export class WorldHost {
  protected worldServices: ReturnType<typeof createScenarioServices>;
  protected activity: Omit<WorldSnapshot, "world">;
  protected readonly initial: WorldState;

  readonly movement: ReturnType<typeof createMovementService>;
  protected writeSimulation<T>(work: () => T): Promise<T> { return Promise.resolve().then(work); }
  protected movementChanged() {}
  protected movementError(error: unknown) { console.error(error); }
  constructor(world: WorldState, saved?: WorldSnapshot, clock?: MovementClock) {
    this.initial = clone(WorldStateSchema, world);
    this.worldServices = createScenarioServices(world);
    this.activity = { version: 8, conversations: {}, npcActivities: {}, playerMessages: [] };
    if (saved) this.restore(saved);
    this.syncGoals();
    this.movement = createMovementService({ currentSimulation: () => this.world().simulation!,
      executeMove: (move, ...args) => this.worldServices.mechanics.executeMove(move, ...args),
      write: work => this.writeSimulation(work), changed: () => this.movementChanged(), error: error => this.movementError(error),
    }, clock);
  }
  /** Live state for synchronous game operations. Never serialize a save to read or update game state. */
  world() { return this.worldServices.currentWorld(); }
  protected syncGoals() {
    const world = this.world();
    const activities = this.activity.npcActivities ??= {};
    for (const character of Object.values(world.simulation!.runtimeCharacters).filter(character => character.characterId !== "player")) {
      const id = character.id, goal = activityGoal(world, id) ?? "", previous = activities[id];
      const activityDocument = characterIntent(world, id).activity;
      if (previous?.goal === goal && previous.activityDocument === activityDocument) continue;
      activities[id] = { status: goal ? "active" : "idle", goal, activityDocument, history: [] };
    }
  }
  /** Detached save data, exclusively for persistence and saved-game exports. */
  snapshot(): WorldSnapshot {
    this.syncGoals();
    return { ...structuredClone(this.activity), world: toJson(WorldStateSchema, this.world()) };
  }
  restore(saved: WorldSnapshot): void {
    if (saved.version !== 8 || !saved.world) throw new Error("This save uses an older world format. Start a fresh game.");
    this.movement?.dispose();
    const { world, ...activity } = saved;
    const state = fromJson(WorldStateSchema, world);
    this.worldServices = createScenarioServices(state);
    this.activity = structuredClone(activity);
    this.movement?.resume();
  }
  protected mutate<T>(operation: (game: PalaceMechanics) => T): T {
    this.syncGoals();
    const game = new PalaceMechanics(this.world(), this.activity, () => this.movement.now(), {
      currentSimulation: () => this.world().simulation!,
      executeMove: (move, ...args) => this.worldServices.mechanics.executeMove(move, ...args),
    });
    const result = operation(game);
    this.activity.npcActivities = game.result().npcActivities;
    return result;
  }
  view(): Record<string, unknown> {
    this.syncGoals();
    const view = worldView(this.world(), this.activity, this.movement.now());
    return { ...view, jail: structuredClone(this.activity.jail ?? null),
      phase: this.world().player ? "conversations" : this.activity.stranger?.draft ? "character_review" : "player_creation",
      playerDraft: structuredClone(this.activity.stranger?.draft ?? null),
      courtAffiliations: this.world().docs[strangerEntry(this.world())] ? creationAffiliations(this.world()) : [],
      gmReplyOptions: structuredClone(this.activity.stranger?.replies ?? null),
      gmMessages: (this.activity.stranger?.history ?? []).filter(turn => (turn.role === "user" || turn.role === "assistant") && !turn.tool_calls?.length && turn.content)
        .map(turn => ({ role: turn.role, text: turn.content })),
      playerMessages: structuredClone(this.activity.playerMessages) };
  }
  debug() { return { documentWorld: toJson(WorldStateSchema, this.world()) }; }
  debugCharacter(id: string) { return { characterId: id, documents: this.world().docs }; }
  debugGameMaster() { return { documentWorld: toJson(WorldStateSchema, this.world()),
    savedTranscript: structuredClone(this.activity.stranger?.history ?? []), promptMatchesCurrentScenario: true,
    compulsion: { active: false, options: this.activity.stranger?.replies?.options ?? [] },
    traceNote: "Model requests are available in the transcript inspector.",
  }; }
  readonly map: MapService = {
    layout: () => {
      const layout = this.world().simulation!.map?.layout;
      if (!layout) throw new Error("A map layout is required.");
      return clone(WorldMapSchema, layout);
    },
    observe: (id, selectedActionId) => {
      const world = this.world(), physical = world.simulation!.map;
      if (!physical) throw new Error("A physical map is required.");
      const projected = mapAtTime(physical, this.movement.now());
      const map = { ...projected, actors: foregroundBodies(projected.actors, projected.actors.find(actor => actor.characterId === id)?.position, this.movement.now()) };
      const characters = characterDocuments(world).map(({ id, document, character }) => ({ id,
        name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
        inventory: character.inventory }));
      if (!characters.some(character => character.id === id) || !map.actors.some(actor => actor.characterId === id && actor.position)) {
        throw new Error("Character is not placed in the palace.");
      }
      const owners = inventoryOwners(characters, map);
      return { characterId: id, map: worldForCharacter(map, owners, id),
        actions: roomAgentActions(map, characters, owners, id, selectedActionId) };
    },
    interact: async (command, signal) => {
      if (command.kind === "step") return this.stepNpcAction(command.characterId, command.actionId, command.goal, signal);
      let worldEvent: Event | undefined, message: string | undefined;
      if (command.kind === "move") {
        const before = this.world().simulation!.map!.actors.find(actor => actor.characterId === "player")!.roomId;
        const outcome = await this.movePlayer(command.destination, signal);
        if (outcome !== "arrived") return { done: false, movementOutcome: outcome };
        const world = this.world().simulation!.map!, player = world.actors.find(actor => actor.characterId === "player")!;
        const room = world.rooms.find(room => room.id === player.roomId)!;
        if (before !== room.id && room.private && !room.allowedCharacterIds.includes("player")) {
          worldEvent = this.worldEvent(`entering ${room.name}`, `The player entered ${room.name} without permission.`, ["player"]);
        }
      }
      if (command.kind === "door") worldEvent = this.setDoor(command.id, command.open);
      if (command.kind === "fixture") { const result = this.interactFixtureWithEvent(command.id); worldEvent = result.event; message = result.message; }
      return { done: true,
        ...(worldEvent ? { worldEvent } : {}), ...(message ? { message } : {}) };
    },
  };
  hasActiveObjective(id: string) { this.syncGoals(); return this.activity.npcActivities?.[id]?.status === "active"; }
  needsNpcReview(id: string) { this.syncGoals(); return this.activity.npcActivities?.[id]?.reviewPending === true; }
  jail() { return this.activity.jail && { ...this.activity.jail }; }
  protected assertPlayerFree() { if (this.activity.jail) throw new Error("You are in jail."); }
  releaseFromJail() { delete this.activity.jail; }
  async movePlayer(destination: Point, signal?: AbortSignal) {
    this.assertPlayerFree();
    const G = this.world().simulation!, map = G.map;
    if (!map?.layout || map.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter the court before walking around.");
    const room = roomAt(map.layout, destination);
    if (!room || !map.rooms.some(existing => existing.id === room.id)) throw new Error("That destination is outside the palace.");
    const current = getActorPosition(G, "player", this.movement.now());
    if (current?.x === destination.x && current.y === destination.y) {
      if (map.actors.find(actor => actor.characterId === "player")?.movement) await this.movement.cancel("player");
      return "arrived" as const;
    }
    return this.movement.move("player", { id: crypto.randomUUID(), to: destination, msPerTile: 100 }, signal);
  }
  setDoor(id: string, open: boolean) {
    this.assertPlayerFree();
    const world = this.world();
    if (!world.simulation!.map) throw new Error("A physical map is required.");
    const name = world.player ? world.docs[world.player]?.frontmatter?.name : undefined;
    const actorId = world.player ? "player" : "", atMs = this.movement.now();
    const error = doorError(world.simulation!, actorId, id, open, atMs);
    if (error) throw new Error(error);
    this.worldServices.mechanics.executeMove(setDoor, actorId, id, open, atMs);
    const door = this.world().simulation!.map!.doors.find(door => door.id === id)!;
    return this.worldEvent("using a door", `${typeof name === "string" ? name : "player"} ${open ? "opened" : "closed"} ${door.name}.`, [actorId]);
  }
  interactFixtureWithEvent(id: string) { this.assertPlayerFree(); return this.mutate(game => game.interactFixtureWithEvent(id)); }
  async stepNpcAction(id: string, actionId: string, goal: string, signal?: AbortSignal): Promise<import("../../../packages/conversation/src/map.js").MapResult> {
    signal?.throwIfAborted();
    const prepared = this.mutate(game => game.prepareNpcAction(id, actionId, goal));
    const { action, actorId, roomId } = prepared;
    if (action.path.length > 1) {
      const door = action.type === "door" ? this.world().simulation!.map!.doors.find(door => door.id === action.target) : undefined;
      const outcome = await this.movement.move(actorId, { id: crypto.randomUUID(), to: action.path.at(-1)!, path: action.path,
        msPerTile: 100, allowedRoomIds: action.type === "move" ? [roomId, action.target] : [roomId],
        ...(door ? { thresholds: [...door.tiles, ...door.interactionSpots] } : {}) }, signal);
      signal?.throwIfAborted();
      if (outcome !== "arrived") return { done: false, movementOutcome: outcome };
    }
    return this.writeSimulation(() => { signal?.throwIfAborted(); return this.mutate(game => game.stepNpcAction(id, actionId, goal)); });
  }
  finishNpcRun(id: string, reason: Parameters<PalaceMechanics["finishNpcRun"]>[1], detail: string) {
    this.mutate(game => game.finishNpcRun(id, reason, detail));
  }
  worldEvent(kind: string, summary: string, participants: string[]) {
    const map = this.world().simulation!.map;
    if (!map) throw new Error("A physical map is required.");
    return createPhysicalEvent({ day: map.day, actors: foregroundBodies(mapAtTime(map, this.movement.now()).actors, undefined, this.movement.now()) }, kind, summary, participants);
  }
  recordPlayerPerception(event: Event, perception: string) {
    const participants = event.participantIds.filter(id => id !== "player");
    const characters = event.kind === "having a conversation" ? characterDocuments(this.world()).map(({ id, document, character }) => ({ id, name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id })) : [];
    const conversationTitle = event.kind === "having a conversation"
      ? `Conversation with ${participants.map(id => characters.find(character => character.id === id)?.name ?? id).join(" and ") || "the court"}`
      : undefined;
    if (!this.activity.playerMessages.some(message => message.id === event.id)) this.activity.playerMessages.push({
      id: event.id, day: event.day, message: perception, createdAt: new Date().toISOString(),
      ...(conversationTitle ? { conversationTitle } : {}),
    });
  }
  reset() {
    this.movement.dispose();
    this.worldServices = createScenarioServices(this.initial);
    this.activity = { version: 8, conversations: {}, npcActivities: {}, playerMessages: [] };
    this.syncGoals();
  }
  resetWorld() {
    this.movement.dispose();
    const before = this.world();
    const map = structuredClone(this.initial.simulation!.map!);
    if (before.player) { map.phase = GamePhase.CONVERSATIONS; map.day = 1; }
    this.worldServices.mechanics.commit(map, {});
  }
  resetCharacters() {
    const current = this.world();
    const docs = { ...current.docs }, runtimeCharacters = { ...current.simulation!.runtimeCharacters };
    for (const path of current.characters) {
      const initial = this.initial.docs[path];
      if (!initial) throw new Error(`No initial character document: ${path}`);
      docs[path] = clone(DocumentSchema, initial);
    }
    for (const [id, character] of Object.entries(current.simulation!.runtimeCharacters)) {
      const initial = this.initial.simulation!.runtimeCharacters[id];
      const mechanics = character.characterId === "player" ? character : initial && clone(RuntimeCharacterSchema, initial);
      runtimeCharacters[id] = { ...character, dnd: mechanics?.dnd, inventory: mechanics?.inventory,
        activity: initial?.activity, wait: initial?.wait,
        intentRevision: character.intentRevision + 1 };
    }
    const draft = refreshDocumentGraph({ ...current, docs, simulation: { ...current.simulation!, runtimeCharacters } });
    validateDocuments(draft);
    current.docs = docs;
    this.worldServices.mechanics.commit(current.simulation!.map!, runtimeCharacters);
    this.activity.npcActivities = {};
    this.activity.conversations = {};
    this.syncGoals();
  }
  async overrideActiveObjective(id: string, objective: unknown) {
    const path = characterIntent(this.world(), id).entry;
    if (!path) throw new Error("Unknown character.");
    const goal = objective && typeof objective === "object"
      ? ("current_goal" in objective ? objective.current_goal : "currentGoal" in objective ? objective.currentGoal : null) : null;
    if (goal !== null && typeof goal !== "string") throw new Error("Expected currentGoal text.");
    const doc = await this.worldServices.docs.read(path);
    const activity = goal ? path.replace(/character\.md$/, `activity-${crypto.randomUUID()}.md`) : null;
    const fields = objective as Record<string, unknown> | null;
    const expected = characterIntent(this.world(), id);
    await this.worldServices.docs.commit([
      ...(activity ? [{ path: activity, expectedSha: null, text: formatActivity(id, {
        name: String(fields?.name ?? goal), status: String(fields?.status ?? "Assigned by the GM."),
        success_criteria: String(fields?.success_criteria ?? fields?.successCriteria ?? goal), current_goal: goal!,
      }) }] : []),
      { path, expectedSha: doc.sha, text: doc.text },
    ], [{ ...expected, activity, wait: null }]);
    this.syncGoals();
  }
}
