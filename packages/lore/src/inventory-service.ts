import { clone, toJson } from "@bufbuild/protobuf";
import { InventorySchema } from "../../contracts/src/index.js";
import { replaceInventories } from "../../core/src/simulation-inventory.js";
import { InventoryConflictError, type InventoryService } from "./service-types.js";
import { canonical, documentSha } from "./document-snapshot.js";
import type { WorldStore } from "./world-store.js";

/** Character inventories are simulation state; document edits never change their versions. */
export function createInventoryService(store: WorldStore): InventoryService {
  const character = (id: string) => {
    const actor = store.state.simulation!.runtimeCharacters[id];
    if (!actor) throw new Error(`Unknown runtime character: ${id}`);
    return actor;
  };
  const version = (id: string) => JSON.stringify(canonical(character(id).inventory
    ? toJson(InventorySchema, character(id).inventory!) : null));
  return {
    async read(actorId) {
      const inventory = character(actorId).inventory;
      const snapshot = inventory && clone(InventorySchema, inventory);
      const sha = await documentSha(version(actorId));
      return { actorId, sha, inventory: snapshot };
    },
    commit: changes => store.write(async () => {
      if (!changes.length || new Set(changes.map(change => change.actorId)).size !== changes.length) throw new Error("Inventory updates require distinct owners");
      const expected = new Map<string, string>();
      for (const change of changes) {
        const current = version(change.actorId);
        if (await documentSha(current) !== change.expectedSha) throw new InventoryConflictError(change.actorId);
        expected.set(change.actorId, current);
      }
      // Mechanics can run while hashes await. Recheck before publishing any inventory.
      for (const [id, before] of expected) if (version(id) !== before) throw new InventoryConflictError(id);
      replaceInventories(store.state.simulation!, changes.map(change => ({ ownerId: change.actorId, inventory: change.inventory })));
    }),
  };
}
