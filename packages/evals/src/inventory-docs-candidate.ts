import { clone, create, fromJson, toJson, type JsonObject } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { InventorySchema } from "../../contracts/src/index.js";
import { CharacterPropertiesSchema, DocumentSchema, WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { validateInventories } from "../../core/src/inventory.js";
import { WorldStore } from "../../lore/src/world-store.js";
import { createDocsService } from "../../lore/src/docs-service.js";
import { createScenarioService } from "../../lore/src/scenario-service.js";
import { snapshot } from "../../lore/src/document-snapshot.js";
import { parseMarkdown } from "../../lore/src/markdown.js";
import { DocumentConflictError, type DocsService } from "../../lore/src/service-types.js";

/** Eval-only hypothesis: expose typed inventory through the existing recorded document tools. */
export function createInventoryReviewServices(initial: WorldState) {
  const store = new WorldStore(initial), base = createDocsService(store);
  const character = (path: string) => store.state.characters.includes(path) || store.state.player === path;
  const read: DocsService["read"] = async path => {
    const current = await base.read(path);
    if (character(path)) {
      const inventory = toJson(InventorySchema, current.document.characterProperties?.inventory ?? create(InventorySchema));
      current.text = `---\n${stringify({ ...current.document.frontmatter, inventory })}---\n${current.document.body}`;
    }
    return current;
  };
  const edit = (path: string, sha: string, transform: (text: string) => string) => store.write(async () => {
    const before = await read(path);
    if (before.sha !== sha) throw new DocumentConflictError(path, sha, before.sha);
    const note = parseMarkdown(transform(before.text));
    if (note.error) throw new Error(note.error);
    if (!Object.hasOwn(note.metadata, "inventory")) throw new Error("Keep inventory present; use items: [] to empty it.");
    const inventory = fromJson(InventorySchema, note.metadata.inventory as JsonObject);
    const metadata = { ...note.metadata }; delete metadata.inventory;
    // No awaits from here to publication: concurrent mechanics cannot be overwritten by a stale draft.
    const live = store.state.docs[path]!;
    if (JSON.stringify(live) !== JSON.stringify(before.document)) throw new DocumentConflictError(path, sha, "changed");
    const draft = clone(WorldStateSchema, store.state), next = draft.docs[path]!;
    next.body = note.body; next.frontmatter = metadata as JsonObject;
    next.characterProperties ??= create(CharacterPropertiesSchema);
    next.characterProperties.inventory = inventory;
    validateInventories([...Object.entries(draft.docs).map(([id, doc]) => ({ id, inventory: doc.characterProperties?.inventory })),
      ...(draft.map?.fixtures ?? []), ...(draft.map?.rooms ?? [])]);
    store.publishDocuments(draft);
    // Capture the exact published version rather than a later queued edit.
    const result = await snapshot(path, clone(DocumentSchema, next));
    result.text = `---\n${stringify({ ...next.frontmatter, inventory: toJson(InventorySchema, inventory) })}---\n${next.body}`;
    return result;
  });
  const docs: DocsService = { ...base, read,
    replace: (path, sha, oldText, newText) => !character(path) ? base.replace(path, sha, oldText, newText) : edit(path, sha, text => {
      const start = text.indexOf(oldText);
      if (!oldText || start < 0 || text.indexOf(oldText, start + 1) >= 0) throw new Error("oldText must match exactly once");
      return text.slice(0, start) + newText + text.slice(start + oldText.length);
    }),
    insert: (path, sha, afterLine, text) => !character(path) ? base.insert(path, sha, afterLine, text) : edit(path, sha, current => {
      const lines = current.split("\n");
      if (current.endsWith("\n")) lines.pop();
      if (!Number.isInteger(afterLine) || afterLine < 0 || afterLine > lines.length) throw new Error("Invalid insertion line");
      const offset = lines.slice(0, afterLine).reduce((total, line) => total + line.length + 1, 0);
      const before = current.slice(0, offset), after = current.slice(offset);
      return before + (before && !before.endsWith("\n") && text ? "\n" : "") + text + (after && text && !text.endsWith("\n") ? "\n" : "") + after;
    }),
  };
  return { docs, scenario: createScenarioService(store, docs) };
}
