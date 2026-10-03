import type { ConversationRuntimeOptions } from "../../conversation/src/runtime.js";
import type { CheckLabels } from "../../conversation/src/check-hooks.js";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { ScenarioSchema, type Scenario } from "../../contracts/src/index.js";
import { BrowserGameRuntime, type RuntimeSnapshot } from "../../../apps/web/src/runtime.js";
import { characterCourtObservation } from "../../../apps/web/src/court-agent.js";
import { renderJevRoomView } from "../../../apps/web/src/jev-room-view.js";

/** A live player console. No eval scenario, score, or automatic turn limit. */
export class HeadlessGame {
  runtime: BrowserGameRuntime;

  constructor(source: Scenario | RuntimeSnapshot, private readonly apiKey = "",
    private readonly conversation?: ConversationRuntimeOptions<CheckLabels>) {
    this.runtime = this.#create(source);
  }

  #create(source: Scenario | RuntimeSnapshot) {
    return "scenario" in source
      ? new BrowserGameRuntime(fromJson(ScenarioSchema, source.scenario), this.apiKey, source)
      : new BrowserGameRuntime(source, this.apiKey);
  }

  load(source: Scenario | RuntimeSnapshot) { this.runtime = this.#create(source); }
  snapshot() { return this.runtime.snapshot(); }
  /** Detached, typed state: edits take effect only through edit() or load(). */
  inspect() { return fromJson(ScenarioSchema, this.snapshot().scenario); }

  edit(change: (state: Scenario) => void) {
    const snapshot = this.snapshot(), state = fromJson(ScenarioSchema, snapshot.scenario);
    change(state);
    snapshot.scenario = toJson(ScenarioSchema, state);
    this.load(snapshot);
  }

  #observation(characterId = this.inspect().playerCharacterId) {
    if (!characterId) throw new Error("Create a player first with game.runtime.createDevelopmentPlayer() or the normal setup flow.");
    return characterCourtObservation(this.inspect(), characterId);
  }

  observe(characterId?: string) {
    const state = this.inspect();
    return renderJevRoomView(state, this.#observation(characterId));
  }

  actions() {
    return this.#observation().actions.map(({ id, description, type, legality }) => ({ id, description, type, legality }));
  }

  /** Compact omniscient overview, distinct from the character-visible room view. */
  overview() {
    const state = this.inspect(), world = state.world;
    if (!world) return "No world loaded.";
    return [`Day ${world.day} · revision ${world.revision} · player ${state.playerCharacterId || "not created"}`,
      ...world.rooms.map(room => {
        const people = world.actors.filter(actor => actor.roomId === room.id).map(actor =>
          `${state.characters.find(character => character.id === actor.characterId)?.name ?? actor.characterId} [${actor.characterId}]`);
        return `${room.name} [${room.id}]: ${people.join(", ") || "empty"}`;
      })].join("\n");
  }

  /** Click-equivalent: walk to the interaction spot, then use player mechanics. */
  act(id: string) {
    const action = this.#observation().actions.find(item => item.id === id);
    if (!action) throw new Error(`Unavailable player action: ${id}`);
    this.runtime.movePlayer(action.path.at(-1)!);
    if (action.type === "door") return { event: this.runtime.setDoor(action.target, action.open!) };
    if (action.type === "fixture") return this.runtime.interactFixtureWithEvent(id);
    // Clicking a character approaches them; speech is a separate explicit action.
    if (action.type === "talk") return { characterId: action.target };
    return { message: action.description };
  }

  move(x: number, y: number) { this.runtime.movePlayer({ x, y }); }

  async talk(characterId: string, message: string) {
    this.act(`talk_${characterId}`);
    return this.conversation
      ? this.runtime.checkedTalkToCharacter(characterId, message, undefined, this.conversation)
      : this.runtime.checkedTalkToCharacter(characterId, message);
  }

  async endConversation(characterId: string, message?: string) {
    if (message !== undefined) this.runtime.endConversationAsPlayer(characterId, message);
    return this.runtime.endConversation(characterId);
  }
}
