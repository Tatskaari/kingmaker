import { validateDocuments } from "../../../packages/lore/src/document-audit.js";
import { movePlayer, setPlayerDoor } from "./physical-movement.js";
import { worldView } from "./world-view.js";
import { createPhysicalEvent } from "./physical-event.js";
import { inventoryOwners } from "../../../packages/core/src/inventory.js";
import { strangerEntry } from "./stranger-lore.js";
import { creationAffiliations } from "./stranger-draft.js";
import type { StrangerState } from "./stranger-interview.js";
import { palaceMap } from "./palace-map.js";
import { GamePhase, WorldMapSchema } from "../../../packages/contracts/src/index.js";
import type { MapService } from "../../../packages/conversation/src/map.js";
import { roomAgentActions } from "./room-actions.js";
import { foregroundBodies } from "./background-characters.js";
import { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import { clone, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { type Event } from "../../../packages/contracts/src/index.js";
import { DocumentSchema, WorldStateSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { createScenarioServices } from "../../../packages/lore/src/services.js";
import { activityGoal, characterIntent, formatActivity } from "../../../packages/lore/src/activity.js";
import { PalaceMechanics, type MechanicalActivity } from "./palace-mechanics.js";
import { characterDocuments, characterId } from "../../../packages/lore/src/character-id.js";
import type { Point } from "./navigation.js";

export type WorldSnapshot = MechanicalActivity & {
  stranger?: StrangerState;
  jail?: { characterId: string; message: string };
  arrestChallenges?: Record<string, boolean>;
  pendingConversationEvents?: Record<string, JsonValue>;
  pendingWaitReviews?: Record<string, { instructions: string; observation: string }>;
  version: 5; world: JsonValue;
  playerMessages: Array<{ id: string; day: number; message: string; createdAt: string; conversationTitle?: string }>;
};

/** Documents and mechanics have one authority; synchronous actions operate on live mechanical state. */
export class WorldHost {
  protected documents: ReturnType<typeof createScenarioServices>;
  protected activity: Omit<WorldSnapshot, "world">;
  protected readonly initial: WorldState;

  constructor(world: WorldState, saved?: WorldSnapshot) {
    this.initial = clone(WorldStateSchema, world);
    this.documents = createScenarioServices(world);
    this.activity = { version: 5, conversations: {}, npcActivities: {}, playerMessages: [] };
    if (saved) this.restore(saved);
    this.syncGoals();
  }
  /** Live state for synchronous game operations. Never serialize a save to read or update game state. */
  world() { return this.documents.currentWorld(); }
  protected syncGoals() {
    const world = this.world();
    const activities = this.activity.npcActivities ??= {};
    for (const character of Object.values(world.runtimeCharacters).filter(character => character.characterId !== "player")) {
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
    if (saved.version !== 5 || !saved.world) throw new Error("This save uses an older world format. Start a fresh game.");
    const { world, ...activity } = saved;
    const state = fromJson(WorldStateSchema, world);
    this.documents = createScenarioServices(state);
    this.activity = structuredClone(activity);
  }
  protected mutate<T>(operation: (game: PalaceMechanics) => T): T {
    this.syncGoals();
    const game = new PalaceMechanics(this.world(), this.activity);
    const result = operation(game);
    const { map, properties, npcActivities } = game.snapshot();
    this.documents.mechanics.commit(map, properties);
    this.activity.npcActivities = npcActivities;
    return result;
  }
  view(): Record<string, unknown> {
    this.syncGoals();
    const view = worldView(this.world(), this.activity);
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
    layout: () => clone(WorldMapSchema, palaceMap),
    observe: id => {
      const world = this.world(), physical = world.map;
      if (!physical) throw new Error("A physical map is required.");
      const map = { ...physical, actors: foregroundBodies(physical.actors, physical.actors.find(actor => actor.characterId === id)?.position) };
      const characters = characterDocuments(world).map(({ id, document }) => ({ id,
        name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
        inventory: document.characterProperties?.inventory }));
      if (!characters.some(character => character.id === id) || !map.actors.some(actor => actor.characterId === id && actor.position)) {
        throw new Error("Character is not placed in the palace.");
      }
      const owners = inventoryOwners(characters, map);
      return { characterId: id, map: worldForCharacter(map, owners, id),
        actions: roomAgentActions(map, characters, owners, id) };
    },
    interact: (command) => {
      if (command.kind === "step") return this.stepNpcAction(command.characterId, command.actionId, command.goal);
      let worldEvent: Event | undefined, message: string | undefined;
      if (command.kind === "move") {
        const before = this.world().map!.actors.find(actor => actor.characterId === "player")!.roomId;
        this.movePlayer(command.destination);
        const world = this.world().map!, player = world.actors.find(actor => actor.characterId === "player")!;
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
  movePlayer(destination: Point) {
    this.assertPlayerFree();
    const world = this.world();
    if (!world.map) throw new Error("A physical map is required.");
    movePlayer(world.map, world.player ? "player" : "", destination);
  }
  setDoor(id: string, open: boolean) {
    this.assertPlayerFree();
    const world = this.world();
    if (!world.map) throw new Error("A physical map is required.");
    const name = world.player ? world.docs[world.player]?.frontmatter?.name : undefined;
    const event = setPlayerDoor(world.map, world.player ? "player" : "", typeof name === "string" ? name : "player", id, open);
    return event;
  }
  interactFixtureWithEvent(id: string) { this.assertPlayerFree(); return this.mutate(game => game.interactFixtureWithEvent(id)); }
  stepNpcAction(id: string, action: string, goal: string) {
    const result = this.mutate(game => game.stepNpcAction(id, action, goal));
    return result;
  }
  finishNpcRun(id: string, reason: Parameters<PalaceMechanics["finishNpcRun"]>[1], detail: string) {
    this.mutate(game => game.finishNpcRun(id, reason, detail));
  }
  worldEvent(kind: string, summary: string, participants: string[]) {
    const map = this.world().map;
    if (!map) throw new Error("A physical map is required.");
    return createPhysicalEvent({ day: map.day, actors: foregroundBodies(map.actors) }, kind, summary, participants);
  }
  recordPlayerPerception(event: Event, perception: string) {
    const participants = event.participantIds.filter(id => id !== "player");
    const characters = event.kind === "having a conversation" ? characterDocuments(this.world()).map(({ id, document }) => ({ id, name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id })) : [];
    const conversationTitle = event.kind === "having a conversation"
      ? `Conversation with ${participants.map(id => characters.find(character => character.id === id)?.name ?? id).join(" and ") || "the court"}`
      : undefined;
    if (!this.activity.playerMessages.some(message => message.id === event.id)) this.activity.playerMessages.push({
      id: event.id, day: event.day, message: perception, createdAt: new Date().toISOString(),
      ...(conversationTitle ? { conversationTitle } : {}),
    });
  }
  reset() {
    this.documents = createScenarioServices(this.initial);
    this.activity = { version: 5, conversations: {}, npcActivities: {}, playerMessages: [] };
    this.syncGoals();
  }
  resetWorld() {
    const before = this.world();
    const map = structuredClone(this.initial.map!);
    if (before.player) { map.phase = GamePhase.CONVERSATIONS; map.day = 1; }
    this.documents.mechanics.commit(map, {});
  }
  resetCharacters() {
    const current = this.world();
    const docs = { ...current.docs }, runtimeCharacters = { ...current.runtimeCharacters };
    for (const path of current.characters) {
      const initial = this.initial.docs[path];
      if (!initial) throw new Error(`No initial character document: ${path}`);
      docs[path] = clone(DocumentSchema, initial);
    }
    for (const [id, character] of Object.entries(current.runtimeCharacters)) {
      const initial = this.initial.runtimeCharacters[id];
      runtimeCharacters[id] = { ...character, activity: initial?.activity, wait: initial?.wait,
        intentRevision: character.intentRevision + 1 };
    }
    validateDocuments({ ...current, docs, runtimeCharacters });
    current.docs = docs;
    current.runtimeCharacters = runtimeCharacters;
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
    const doc = await this.documents.docs.read(path);
    const activity = goal ? path.replace(/character\.md$/, `activity-${crypto.randomUUID()}.md`) : null;
    const fields = objective as Record<string, unknown> | null;
    const expected = characterIntent(this.world(), id);
    await this.documents.docs.commit([
      ...(activity ? [{ path: activity, expectedSha: null, text: formatActivity(id, {
        name: String(fields?.name ?? goal), status: String(fields?.status ?? "Assigned by the GM."),
        success_criteria: String(fields?.success_criteria ?? fields?.successCriteria ?? goal), current_goal: goal!,
      }) }] : []),
      { path, expectedSha: doc.sha, text: doc.text },
    ], [{ ...expected, activity, wait: null }]);
    this.syncGoals();
  }
}
