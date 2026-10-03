import { links, resolveLink, AmbiguousLinkError, type Note } from "./markdown.js";
import { permitted, labels, type Audience } from "./access.js";

export interface Finding { kind: "denied" | "broken" | "ambiguous" | "invalid"; trail: string[]; detail: string }

/** Audit a character's complete graph using the same rules at build time and at runtime. */
export function auditNotes(notes: ReadonlyMap<string, Note>, entry: string, audience: Audience): Finding[] {
  const findings: Finding[] = [];
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
