import { createInventoryService } from "../../core/src/inventory-service.js";
import type { WorldState } from "../../contracts/src/v2.js";
import { WorldStore } from "./world-store.js";
import { createDocsService } from "./docs-service.js";
import { createCharacterService } from "./character-service.js";
import { createMechanicsService } from "./mechanics-service.js";
import { createScenarioService } from "./scenario-service.js";
import { createQuestService } from "./quest-service.js";

export * from "./service-types.js";
export { QuestConflictError, type QuestService } from "./quest-service.js";

/** World services share one authority and write queue across documents and simulation. */
export function createScenarioServices(initial: WorldState) {
  const store = new WorldStore(initial);
  const docs = createDocsService(store);
  // Trusted synchronous host code reads live state; document APIs retain CAS snapshots.
  const inventory = createInventoryService({
    currentSimulation: () => store.state.simulation!,
    write: action => store.write(action),
    executeMove: (move, ...args) => store.executeMove(move, ...args),
  });
  return { inventory, quests: createQuestService(store), currentWorld: () => store.state, docs, scenario: createScenarioService(store, docs),
    character: createCharacterService(store), mechanics: createMechanicsService(store) };
}
