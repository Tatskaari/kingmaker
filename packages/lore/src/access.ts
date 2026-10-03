import type { Note } from "./markdown.js";

export interface Audience { character: string; factions?: string[]; grants?: string[] }

export function permitted(name: string, note: Note, entry: string, audience: Audience): boolean {
  const { visibility, readers } = note.metadata;
  if (visibility !== undefined && (typeof visibility !== "string" || !["public", "private", "gm"].includes(visibility))) throw new Error("Unknown visibility");
  const list = (value: unknown): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.length > 0)) throw new Error("Readers must be lists of IDs");
    return value;
  };
  if (readers !== undefined && (!readers || typeof readers !== "object" || Array.isArray(readers))) throw new Error("readers must be a mapping");
  const fields = (readers ?? {}) as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["characters", "factions"].includes(key))) throw new Error("Unknown readers field");
  const characters = list(fields.characters), factions = list(fields.factions);
  if (visibility === "public") return true;
  if (visibility === "gm") return false;
  if (visibility === "private") return characters.includes(audience.character)
    || factions.some(faction => audience.factions?.includes(faction)) || !!audience.grants?.includes(name);
  // Only legacy scenario detail has implicit character access. Cast and indexes fail closed.
  return name.startsWith(entry.slice(0, entry.lastIndexOf("/") + 1)) && name.slice(name.lastIndexOf("/") + 1) !== "index.md";
}
