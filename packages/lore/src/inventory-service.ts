import { clone } from "@bufbuild/protobuf";
import { InventorySchema } from "../../contracts/src/index.js";
import { validateInventories } from "../../core/src/inventory.js";
import { DocumentConflictError, type InventoryService } from "./service-types.js";
import { documentSha, documentVersion } from "./document-snapshot.js";
import type { WorldStore } from "./world-store.js";

/** Update all owners of a trade atomically; preserve everything outside their inventories. */
export function createInventoryService(store: WorldStore): InventoryService {
  return { commit: changes => store.write(async () => {
    if (!changes.length || new Set(changes.map(change => change.path)).size !== changes.length) throw new Error("Inventory updates require distinct owners");
    const expected = new Map<string, string>();
    for (const change of changes) {
      const document = store.state.docs[change.path];
      if (!document?.characterProperties) throw new Error(`Not a character inventory: ${change.path}`);
      const version = documentVersion(document);
      const sha = await documentSha(version);
      if (sha !== change.expectedSha) throw new DocumentConflictError(change.path, change.expectedSha, sha);
      expected.set(change.path, version);
    }
    // Compare synchronously after hashing; mechanics can run while hashes await.
    for (const [path, document] of expected) {
      if (!store.state.docs[path] || documentVersion(store.state.docs[path]!) !== document) throw new DocumentConflictError(path, "read version", "changed");
    }
    // Stage only replacement inventories. All validation precedes synchronous mutation.
    const replacements = new Map(changes.map(change => [change.path, clone(InventorySchema, change.inventory)]));
    validateInventories(Object.entries(store.state.docs).flatMap(([id, doc]) => doc.characterProperties
      ? [{ id, inventory: replacements.get(id) ?? doc.characterProperties.inventory }] : []));
    for (const [path, inventory] of replacements) store.state.docs[path]!.characterProperties!.inventory = inventory;
  }) };
}
