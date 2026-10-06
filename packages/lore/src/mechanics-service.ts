import type { MechanicsStateService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createMechanicsService(store: WorldStore): MechanicsStateService {
  return {
    commit(map, characters) {
      for (const id of Object.keys(characters)) {
        if (!store.state.simulation!.runtimeCharacters[id]) throw new Error(`Unknown character: ${id}`);
      }
      // Publish the current mechanical records without mutating an older simulation root.
      store.state.simulation = { ...store.state.simulation!, map,
        runtimeCharacters: { ...store.state.simulation!.runtimeCharacters, ...characters } };
    },
  };
}
