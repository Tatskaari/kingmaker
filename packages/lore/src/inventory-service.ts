import { clone } from "@bufbuild/protobuf";
import { InventorySchema } from "../../contracts/src/index.js";
import { DocumentSchema, WorldStateSchema } from "../../contracts/src/v2.js";
import { validateInventories } from "../../core/src/inventory.js";
import { DocumentConflictError, type InventoryService } from "./service-types.js";
import { snapshot } from "./document-snapshot.js";
import type { WorldStore } from "./world-store.js";

/** Update all owners of a trade atomically; preserve everything outside their inventories. */
export function createInventoryService(store: WorldStore): InventoryService {
  return { commit: changes => store.write(async () => {
    if (!changes.length || new Set(changes.map(change => change.path)).size !== changes.length) throw new Error("Inventory updates require distinct owners");
    const expected = new Map<string, string>();
    for (const change of changes) {
      const document = store.state.docs[change.path];
      if (!document?.characterProperties) throw new Error(`Not a character inventory: ${change.path}`);
      const captured = clone(DocumentSchema, document);
      const current = await snapshot(change.path, captured);
      if (current.sha !== change.expectedSha) throw new DocumentConflictError(change.path, change.expectedSha, current.sha);
      expected.set(change.path, JSON.stringify(captured));
    }
    // Compare synchronously after hashing; mechanics can run while hashes await.
    for (const [path, document] of expected) {
      if (JSON.stringify(store.state.docs[path]) !== document) throw new DocumentConflictError(path, "read version", "changed");
    }
    const draft = clone(WorldStateSchema, store.state);
    for (const change of changes) draft.docs[change.path]!.characterProperties!.inventory = clone(InventorySchema, change.inventory);
    validateInventories(Object.entries(draft.docs).flatMap(([id, doc]) => doc.characterProperties ? [{ id, inventory: doc.characterProperties.inventory }] : []));
    store.publishDocuments(draft);
  }) };
}
