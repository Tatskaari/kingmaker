import type { WorldState } from "../../contracts/src/v2.js";
import { permitted } from "./access.js";
import { auditNotes, type Finding } from "./audit.js";
import { type Note } from "./markdown.js";

export class DocumentValidationError extends Error {
  constructor(readonly findings: Finding[]) {
    super(`Document validation failed: ${JSON.stringify(findings)}`);
    this.name = "DocumentValidationError";
  }
}

/** Check access after the document graph validates all links in the unpublished draft. */
export function validateDocuments(state: WorldState): void {
  const findings = auditDocuments(state);
  if (findings.length) throw new DocumentValidationError(findings);
}

function auditDocuments(state: WorldState): Finding[] {
  const notes = new Map<string, Note>(Object.entries(state.docs).map(([path, doc]) =>
    [path, { body: doc.body, metadata: doc.frontmatter ?? {} }]));
  const findings: Finding[] = [];
  for (const [path, note] of notes) {
    try {
      permitted(path, note, "", { character: "" }); // Validate metadata even on unlinked notes.
    } catch (error) { findings.push({ kind: "invalid", trail: [path], detail: String(error) }); }
  }
  const resolved = new Map(Object.entries(state.docs).map(([path, doc]) => [path, doc.links.map(link => link.target)]));
  const prefix = state.scenario.slice(0, state.scenario.lastIndexOf("/") + 1) + "Characters/";
  for (const entry of notes.keys()) {
    if (!(entry.startsWith(prefix) && /^[^/]+\/character\.md$/.test(entry.slice(prefix.length))) && entry !== state.player && entry !== "Players/player.md") continue;
    const character = entry.startsWith(prefix) ? entry.slice(prefix.length).split("/")[0]! : "player";
    const scoped = new Map(resolved);
    scoped.set(entry, [...(resolved.get(entry) ?? []), ...Object.values(state.simulation!.runtimeCharacters)
      .filter(actor => actor.characterId === character).flatMap(actor => [actor.activity, actor.wait].filter((path): path is string => path !== undefined))]);
    findings.push(...auditNotes(notes, entry, { character }, scoped));
  }
  return findings;
}
