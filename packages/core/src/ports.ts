import type {
  ActionResult,
  AvailableAction,
  Character,
  ConversationMemory,
  DecisionRequest,
  DecisionResponse,
  DialogueRequest,
  DialogueResponse,
  Event,
  GameMasterRequest,
  GameMasterResponse,
  PlayerSetup,
  Scenario,
  WorldState,
} from "../../contracts/src/index.js";

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly { code: string; message: string }[] };

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Produces the deliberately large MVP prompt: instructions, identity,
 * relationships, visible events, the whole world, then conversation history. */
export interface DialogueContextBuilder {
  build(request: DialogueRequest): readonly PromptMessage[];
}

export interface GameMasterContextBuilder {
  build(request: GameMasterRequest): readonly PromptMessage[];
}

/** A generative model speaks and may propose a new free-text goal and events. */
export interface DialogueModel {
  respond(request: DialogueRequest, signal?: AbortSignal): Promise<DialogueResponse>;
}

/** The same generative provider may back both roles, but their contracts and
 * prompts remain separate. */
export interface GameMasterModel {
  respond(request: GameMasterRequest, signal?: AbortSignal): Promise<GameMasterResponse>;
}

/** Creates grounded actions from engine state. Implementations should expose
 * broad affordances and all sensible targets instead of scripting a path.
 * Sleeping actors get wake; awake actors get adjacent moves and room search;
 * discovered spots become concrete interactions such as open desk. */
export interface ActionSource {
  availableTo(character: Character, world: WorldState): readonly AvailableAction[];
}

/** Jev chooses one supplied action based on character, goal, events and world. */
export interface ActionPolicy {
  choose(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>;
}

/** Applies a chosen action to authoritative state and emits what happened. */
export interface WorldEngine {
  world(): WorldState;
  apply(action: AvailableAction, expectedRevision: number): Validation<ActionResult>;
}

export interface EventLog {
  append(events: readonly Event[]): void;
  visibleTo(characterId: string): readonly Event[];
}

/** One autonomous turn: enumerate actions, ask Jev, validate the selected ID,
 * apply it, and append the resulting events. */
export interface AgentLoop {
  step(characterId: string, signal?: AbortSignal): Promise<Validation<ActionResult>>;
}

/** Runs one autonomous turn for every non-player character during the night. */
export interface NightPhase {
  run(npcCharacterIds: readonly string[], signal?: AbortSignal): Promise<readonly Validation<ActionResult>[]>;
}

export interface GameState {
  scenario(): Scenario;
  createPlayer(setup: PlayerSetup): Validation<Character>;
  replaceGoal(characterId: string, goal: string): Validation<Character>;
  commitDialogue(characterId: string, response: DialogueResponse): Validation<readonly Event[]>;
  commitConversation(characterId: string, memory: ConversationMemory): Validation<readonly Event[]>;
  commitGameMaster(response: GameMasterResponse): Validation<readonly Event[]>;
}
