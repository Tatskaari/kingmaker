import type { MechanicsStateService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createMechanicsService(store: WorldStore): MechanicsStateService {
  return {
    commit(map, characters) {
      for (const id of Object.keys(characters)) {
        if (!store.state.simulation!.runtimeCharacters[id]) throw new Error(`Unknown character: ${id}`);
      }
      // Mechanics are synchronous. Publish live references without copying the document world.
      store.state.simulation!.map = map;
      for (const [id, value] of Object.entries(characters)) store.state.simulation!.runtimeCharacters[id] = value;
    },
  };
}
