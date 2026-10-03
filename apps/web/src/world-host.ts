import { creationAffiliations } from "./stranger-draft.js";
import type { StrangerState } from "./stranger-interview.js";
import { palaceMap } from "./palace-map.js";
import { GamePhase, WorldMapSchema } from "../../../packages/contracts/src/index.js";
import type { MapService } from "../../../packages/conversation/src/map.js";
import { characterCourtObservation } from "./court-agent.js";
import { worldForCharacter } from "../../../packages/core/src/context.js";
import { clone, create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ScenarioSchema, type Event } from "../../../packages/contracts/src/index.js";
import { CharacterPropertiesSchema, WorldStateSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { createScenarioServices } from "../../../packages/lore/src/services.js";
import { activeGoal } from "../../../packages/lore/src/active-goal.js";
import { generationIds, type ExpectedGenerations } from "../../../packages/core/src/generations.js";
import { PalaceMechanics, type MechanicalActivity } from "./palace-mechanics.js";
import { characterId, projectWorld } from "./world-projection.js";
import type { Point } from "./navigation.js";

export type WorldSnapshot = MechanicalActivity & {
  stranger?: StrangerState;
  version: 2; world: JsonValue;
  playerMessages: Array<{ id: string; day: number; message: string; createdAt: string }>;
};

/** Documents and mechanics have one authority. Palace mechanics are a disposable rules/view adapter. */
export class WorldHost {
  protected documents: ReturnType<typeof createScenarioServices>;
  protected activity: Omit<WorldSnapshot, "world">;
  protected readonly initial: WorldState;

  constructor(world: WorldState, saved?: WorldSnapshot) {
    this.initial = clone(WorldStateSchema, world);
    this.documents = createScenarioServices(world);
    this.activity = { version: 2, conversations: {}, npcActivities: {}, playerMessages: [] };
    if (saved) this.restore(saved);
    this.syncGoals();
  }
  world() { return this.documents.scenario.snapshot(); }
  protected syncGoals() {
    const world = this.world();
    const activities = this.activity.npcActivities ??= {};
    for (const path of world.characters) {
      const id = characterId(path, world), goal = activeGoal(world.docs[path]!) ?? "", previous = activities[id];
      if (previous?.goal === goal) continue;
      activities[id] = { status: goal ? "active" : "idle", goal, history: [] };
    }
  }
  snapshot(): WorldSnapshot {
    this.syncGoals();
    return structuredClone({ ...this.activity, world: toJson(WorldStateSchema, this.world()) });
  }
  restore(saved: WorldSnapshot): void {
    if (saved.version !== 2 || !saved.world) throw new Error("This save uses an older world format. Start a fresh game.");
    const { world, ...activity } = structuredClone(saved);
    const state = fromJson(WorldStateSchema, world);
    this.documents = createScenarioServices(state);
    this.activity = activity;
  }
  protected projection() {
    this.syncGoals();
    const scenario = projectWorld(this.world());
    return new PalaceMechanics(scenario, this.activity);
  }
  private remember(game: PalaceMechanics) {
    const { scenario: _scenario, ...activity } = game.snapshot();
    this.activity = { ...this.activity, ...activity };
  }
  protected mutate<T>(operation: (game: PalaceMechanics) => T, expected?: ExpectedGenerations): T {
    const before = this.world(), game = this.projection();
    const result = operation(game);
    const next = fromJson(ScenarioSchema, game.snapshot().scenario);
    const properties = Object.fromEntries([...before.characters, ...(before.player ? [before.player] : [])].map(path => {
      const character = next.characters.find(item => item.id === characterId(path, before))!;
      return [path, create(CharacterPropertiesSchema, { ...(character.dnd ? { dnd: character.dnd } : {}),
        ...(character.inventory ? { inventory: character.inventory } : {}) })];
    }));
    this.documents.mechanics.commit(next.world!, properties);
    this.remember(game);
    return result;
  }
  view(): Record<string, unknown> {
    const game = this.projection(), view = game.view(); this.remember(game);
    return { ...view,
      phase: this.world().player ? "conversations" : this.activity.stranger?.draft ? "character_review" : "player_creation",
      playerDraft: structuredClone(this.activity.stranger?.draft ?? null),
      courtAffiliations: [...creationAffiliations],
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
  readResources(keys?: string[]) {
    const game = this.projection(), values = game.readResources(keys); this.remember(game);
    return values;
  }
  readonly map: MapService = {
    layout: () => clone(WorldMapSchema, palaceMap),
    observe: id => {
      const scenario = projectWorld(this.world());
      return { characterId: id, map: worldForCharacter(scenario, id),
        actions: characterCourtObservation(scenario, id).actions };
    },
    interact: (command, expected) => {
      if (command.kind === "step") return this.stepNpcAction(command.characterId, command.actionId, command.goal, expected);
      let worldEvent: Event | undefined, message: string | undefined;
      if (command.kind === "move") this.movePlayer(command.destination, expected);
      if (command.kind === "door") worldEvent = this.setDoor(command.id, command.open, expected);
      if (command.kind === "fixture") { const result = this.interactFixtureWithEvent(command.id, expected); worldEvent = result.event; message = result.message; }
      return { done: true, generations: generationIds(this.readResources()),
        ...(worldEvent ? { worldEvent } : {}), ...(message ? { message } : {}) };
    },
  };
  hasActiveObjective(id: string) { this.syncGoals(); return this.activity.npcActivities?.[id]?.status === "active"; }
  movePlayer(destination: Point, expected?: ExpectedGenerations) { return this.mutate(game => game.movePlayer(destination, expected), expected); }
  setDoor(id: string, open: boolean, expected?: ExpectedGenerations) { return this.mutate(game => game.setDoor(id, open, expected), expected); }
  interactFixtureWithEvent(id: string, expected?: ExpectedGenerations) { return this.mutate(game => game.interactFixtureWithEvent(id, expected), expected); }
  stepNpcAction(id: string, action: string, goal: string, expected?: ExpectedGenerations) {
    const result = this.mutate(game => game.stepNpcAction(id, action, goal, expected), expected);
    return result;
  }
  finishNpcRun(id: string, reason: Parameters<PalaceMechanics["finishNpcRun"]>[1], detail: string, expected?: ExpectedGenerations) {
    this.mutate(game => game.finishNpcRun(id, reason, detail, expected), expected);
  }
  worldEvent(kind: string, summary: string, participants: string[]) { return this.projection().worldEvent(kind, summary, participants); }
  recordPlayerPerception(event: Event, perception: string) {
    if (!this.activity.playerMessages.some(message => message.id === event.id)) this.activity.playerMessages.push({
      id: event.id, day: event.day, message: perception, createdAt: new Date().toISOString(),
    });
  }
  reset() { this.restore({ version: 2, world: toJson(WorldStateSchema, this.initial),
    conversations: {}, npcActivities: {}, playerMessages: [] }); }
  resetWorld() {
    const before = this.world();
    const map = structuredClone(this.initial.map!);
    if (before.player) { map.phase = GamePhase.CONVERSATIONS; map.day = 1; }
    this.documents.mechanics.commit(map, {});
  }
  resetCharacters() {
    const current = this.world();
    for (const path of current.characters) current.docs[path] = clone(WorldStateSchema, this.initial).docs[path]!;
    this.restore({ ...this.snapshot(), world: toJson(WorldStateSchema, current), npcActivities: {}, conversations: {} });
  }
  async overrideActiveObjective(id: string, objective: unknown) {
    const path = this.world().characters.find(path => characterId(path, this.world()) === id);
    if (!path) throw new Error("Unknown character.");
    const goal = objective && typeof objective === "object"
      ? ("current_goal" in objective ? objective.current_goal : "currentGoal" in objective ? objective.currentGoal : null) : null;
    if (goal !== null && typeof goal !== "string") throw new Error("Expected currentGoal text.");
    const doc = await this.documents.docs.read(path);
    const { stringify } = await import("yaml");
    const text = `---\n${stringify({ ...doc.document.frontmatter, active_goal: goal })}---\n${doc.document.body}`;
    await this.documents.docs.replace(path, doc.sha, doc.text, text);
    this.syncGoals();
  }
}
