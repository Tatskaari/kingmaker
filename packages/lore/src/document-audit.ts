import type { WorldState } from "../../contracts/src/v2.js";
import { permitted } from "./access.js";
import { auditNotes, type Finding } from "./audit.js";
import { AmbiguousLinkError, links, parseMarkdown, resolveLink, type Note } from "./markdown.js";

export interface DocumentProposal { path: string; text: string }

/** Read-only preflight of live documents, optionally overlaying one proposed create or edit. */
export function auditDocuments(state: WorldState, proposal?: DocumentProposal): Finding[] {
  const notes = new Map<string, Note>(Object.entries(state.docs).map(([path, doc]) =>
    [path, { body: doc.body, metadata: doc.frontmatter ?? {} }]));
  if (proposal) notes.set(proposal.path, parseMarkdown(proposal.text));
  const findings: Finding[] = [];
  for (const [path, note] of notes) {
    try {
      if (path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..") || !path.endsWith(".md")) {
        throw new Error("Expected a vault-relative Markdown path");
      }
      if (note.error) throw new Error(note.error);
      permitted(path, note, "", { character: "" }); // Validate metadata even on unlinked notes.
    } catch (error) { findings.push({ kind: "invalid", trail: [path], detail: String(error) }); }
    for (const link of links(note.body)) {
      try { resolveLink(notes, path, link); }
      catch (error) { findings.push({ kind: error instanceof AmbiguousLinkError ? "ambiguous" : "broken",
        trail: [path, link.target], detail: String(error) }); }
    }
  }
  const prefix = state.scenario.slice(0, state.scenario.lastIndexOf("/") + 1) + "Characters/";
  for (const entry of notes.keys()) {
    if (!(entry.startsWith(prefix) && /^[^/]+\/character\.md$/.test(entry.slice(prefix.length))) && entry !== state.player) continue;
    const character = entry.startsWith(prefix) ? entry.slice(prefix.length).split("/")[0]! : "player";
    findings.push(...auditNotes(notes, entry, { character }));
  }
  return findings;
}
