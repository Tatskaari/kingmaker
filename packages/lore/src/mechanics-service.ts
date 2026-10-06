import type { MechanicsStateService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createMechanicsService(store: WorldStore): MechanicsStateService {
  return {
    commit(map, properties) {
      for (const path of Object.keys(properties)) {
        if (!store.state.docs[path]) throw new Error(`Unknown character document: ${path}`);
      }
      // Mechanics are synchronous. Publish live references without copying the document world.
      store.state.simulation!.map = map;
      for (const [path, value] of Object.entries(properties)) store.state.docs[path]!.characterProperties = value;
    },
  };
}
