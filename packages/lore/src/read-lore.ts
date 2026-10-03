import { readFileSync } from "node:fs";
import path from "node:path";
import { readVault, type Note } from "./vault.js";

/** Load Markdown plus the existing GM-only scenario character property sidecars. */
export function readLore(root: string): Map<string, Note> {
  const notes = readVault(root);
  for (const [name, note] of notes) {
    if (!/^Scenarios\/[^/]+\/Characters\/[^/]+\/character\.md$/.test(name)) continue;
    const sidecar = path.posix.join(path.posix.dirname(name), "properties.json");
    let source: string;
    try {
      source = readFileSync(path.join(root, sidecar), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    try {
      const properties: unknown = JSON.parse(source);
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        throw new Error("Character properties must be an object");
      }
      note.characterProperties = properties as Record<string, unknown>;
    } catch (error) {
      throw new Error(`${sidecar}: ${String(error)}`, { cause: error });
    }
  }
  return notes;
}
