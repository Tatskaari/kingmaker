import type { Event, MapState, WorldMap } from "../../contracts/src/index.js";
import type { GameAction } from "../../core/src/actions.js";

export interface MapObservation {
  characterId: string;
  /** Detached observer-visible physical data; no character documents. */
  map: MapState;
  actions: readonly GameAction[];
}
export type MapCommand =
  | { kind: "move"; destination: { x: number; y: number } }
  | { kind: "door"; id: string; open: boolean }
  | { kind: "fixture"; id: string }
  | { kind: "step"; characterId: string; actionId: string; goal: string };
export interface MapResult {
  done: boolean;
  movementOutcome?: import("../../core/src/movement-service.js").MovementOutcome;
  talkTarget?: string;
  worldEvent?: Event;
  message?: string;
}
export interface MapService {
  layout(): WorldMap;
  observe(characterId: string): MapObservation;
  /** Validate and commit against current state. Movement resolves on arrival; a step then revalidates its interaction. */
  interact(command: Readonly<MapCommand>, signal?: AbortSignal): MapResult | Promise<MapResult>;
}
