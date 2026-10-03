import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseMarkdown, links, resolveLink, AmbiguousLinkError, type Note } from "../../packages/lore/src/markdown.js";

import { permitted, labels, type Audience } from "../../packages/lore/src/access.js";
export { permitted, type Audience } from "../../packages/lore/src/access.js";
export interface Finding { kind: "denied" | "broken" | "ambiguous" | "invalid"; trail: string[]; detail: string }

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
  const notes = readVault(root), findings: Finding[] = [];
  if (entry.split("/").some(part => part === "." || part === "..") || !/^Scenarios\/.+\/Characters\/[^/]+\/character\.md$/.test(entry)
    || path.posix.basename(path.posix.dirname(entry)) !== audience.character) throw new Error("Entry must be this character's Scenarios/.../Characters/<id>/character.md");
  try {
    audience = { ...audience, labels: [...(audience.labels ?? []), ...labels(notes.get(entry)?.metadata.labels)],
      factions: [...(audience.factions ?? []), ...labels(notes.get(entry)?.metadata.factions)] };
  } catch (error) {
    return [{ kind: "invalid", trail: [entry], detail: String(error) }];
  }
  const visited = new Set<string>();
  const queue: string[][] = [[entry]];
  for (const trail of queue) {
    const name = trail.at(-1)!;
    if (visited.has(name)) continue;
    visited.add(name);
    const note = notes.get(name);
    if (!note) { findings.push({ kind: "broken", trail, detail: "Note does not exist" }); continue; }
    try {
      if (note.error) throw new Error(note.error);
      if (!permitted(name, note, entry, audience)) findings.push({ kind: "denied", trail, detail: "Character has no read access" });
    } catch (error) { findings.push({ kind: "invalid", trail, detail: String(error) }); }
    // Audit the entire authoring graph, including links beyond a denied note.
    for (const link of links(note.body)) {
      try {
        const target = resolveLink(notes, name, link);
        if (target) queue.push([...trail, target]);
      } catch (error) {
        findings.push({ kind: error instanceof AmbiguousLinkError ? "ambiguous" : "broken",
          trail: [...trail, link.target], detail: String(error) });
      }
    }
  }
  return findings;
}
