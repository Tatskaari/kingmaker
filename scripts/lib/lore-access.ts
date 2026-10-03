import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseMarkdown, type Note } from "../../packages/lore/src/markdown.js";

import { type Audience } from "../../packages/lore/src/access.js";
export { permitted, type Audience } from "../../packages/lore/src/access.js";
import { auditNotes, type Finding } from "../../packages/lore/src/audit.js";
export type { Finding } from "../../packages/lore/src/audit.js";

export function readVault(root: string): Map<string, Note> {
  const notes = new Map<string, Note>();
  function visit(directory: string) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.name.endsWith(".md")) {
        notes.set(name, parseMarkdown(readFileSync(path.join(root, name), "utf8")));
      }
    }
  }
  visit("");
  return notes;
}


export function auditLore(root: string, entry: string, audience: Audience): Finding[] {
  const notes = readVault(root);
  if (entry.split("/").some(part => part === "." || part === "..") || !/^Scenarios\/.+\/Characters\/[^/]+\/character\.md$/.test(entry)
    || path.posix.basename(path.posix.dirname(entry)) !== audience.character) throw new Error("Entry must be this character's Scenarios/.../Characters/<id>/character.md");
  return auditNotes(notes, entry, audience);
}
