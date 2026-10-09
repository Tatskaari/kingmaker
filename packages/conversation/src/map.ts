import type { CharacterHistoryEntry } from "../../core/src/character-history.js";
import type { Event, MapState, WorldMap } from "../../contracts/src/index.js";
import type { GameAction } from "../../core/src/actions.js";

export interface MapObservation {
  characterId: string;
  /** Detached observer-visible physical data; no character documents. */
  map: MapState;
  actions: readonly GameAction[];
  /** This character’s completed actions interleaved with their perceived events. */
  recentHistory?: readonly CharacterHistoryEntry[];
}
export type MapCommand =
  | { kind: "move"; destination: { x: number; y: number } }
  | { kind: "door"; id: string; open: boolean }
  | { kind: "fixture"; id: string }
  | { kind: "step"; characterId: string; actionId: string; goal: string };
export interface MapResult {
  done: boolean;
  roll?: import("../../core/src/cart.js").CartStrengthCheck;
  movementOutcome?: import("../../core/src/movement-service.js").MovementOutcome;
  talkTarget?: string;
  worldEvent?: Event;
  message?: string;
}
export interface MapService {
  layout(): WorldMap;
  /** Discovery does not pathfind. An explicit selected action ID requests its executable route. */
  observe(characterId: string, selectedActionId?: string): MapObservation;
  /** Validate and commit against current state. Movement resolves on arrival; a step then revalidates its interaction. */
  interact(command: Readonly<MapCommand>, signal?: AbortSignal): MapResult | Promise<MapResult>;
}
