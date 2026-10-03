import type { Event, WorldState, WorldMap } from "../../contracts/src/index.js";
import type { GameAction } from "../../core/src/actions.js";
import type { ExpectedGenerations } from "../../core/src/generations.js";

export interface MapObservation {
  characterId: string;
  /** Detached observer-visible physical data; no character documents. */
  map: WorldState;
  actions: readonly GameAction[];
}
export type MapCommand =
  | { kind: "move"; destination: { x: number; y: number } }
  | { kind: "door"; id: string; open: boolean }
  | { kind: "fixture"; id: string }
  | { kind: "step"; characterId: string; actionId: string; goal: string };
export interface MapResult {
  done: boolean;
  talkTarget?: string;
  worldEvent?: Event;
  message?: string;
  generations: ExpectedGenerations;
}
export interface MapService {
  layout(): WorldMap;
  observe(characterId: string): MapObservation;
  /** Validate and commit against current state. A step advances at most one tile. */
  interact(command: Readonly<MapCommand>, expected?: ExpectedGenerations): MapResult;
}
