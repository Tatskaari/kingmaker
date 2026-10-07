import { publishSimulationChanges } from "../../core/src/simulation-publication.js";
import type { MechanicsStateService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createMechanicsService(store: WorldStore): MechanicsStateService {
  return {
    executeMove: (move, ...args) => store.executeMove(move, ...args),
    commit(map, characters) {
      for (const id of Object.keys(characters)) {
        if (!store.state.simulation!.runtimeCharacters[id]) throw new Error(`Unknown character: ${id}`);
      }
      store.executeMove(publishSimulationChanges, { map, characters });
    },
  };
}
