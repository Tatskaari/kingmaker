import type { WorldState } from "../../contracts/src/v2.js";
import { WorldStore } from "./world-store.js";
import { createDocsService } from "./docs-service.js";
import { createCharacterService } from "./character-service.js";
import { createMechanicsService } from "./mechanics-service.js";
import { createScenarioService } from "./scenario-service.js";

export * from "./service-types.js";

/** Services share one owned state and serialized document writes. */
export function createScenarioServices(initial: WorldState) {
  const store = new WorldStore(initial);
  const docs = createDocsService(store);
  return { docs, scenario: createScenarioService(store, docs),
    character: createCharacterService(store), mechanics: createMechanicsService(store) };
}
