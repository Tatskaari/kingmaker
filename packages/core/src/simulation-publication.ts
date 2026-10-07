import { INVALID_MOVE } from "boardgame.io/core";
import type { MapState } from "../../contracts/src/index.js";
import type { RuntimeCharacter } from "../../contracts/src/v2.js";
import type { SimulationMoveContext } from "./simulation-move.js";

/** Authority-only publication after the owning service validates documents and mechanics. */
export function publishSimulationChanges({ G }: SimulationMoveContext, changes: {
  map?: MapState | undefined;
  characters?: Record<string, RuntimeCharacter>;
}) {
  if (changes.characters && Object.entries(changes.characters).some(([id, actor]) => actor.id !== id)) return INVALID_MOVE;
  if (changes.map) G.map = changes.map;
  if (changes.characters) Object.assign(G.runtimeCharacters, changes.characters);
}
