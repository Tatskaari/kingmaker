import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent, Root } from "mdast";
import { parse } from "yaml";

export interface Audience { character: string; factions?: string[]; grants?: string[] }
export interface Finding { kind: "denied" | "broken" | "ambiguous" | "invalid"; trail: string[]; detail: string }
interface Note { body: string; metadata: Record<string, unknown>; error?: string }

export function readVault(root: string): Map<string, Note> {
  const notes = new Map<string, Note>();
  function visit(directory: string) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.name.endsWith(".md")) {
        const source = readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, "");
        const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
        try {
          if (source.startsWith("---\n") || source.startsWith("---\r\n")) {
            if (!header) throw new Error("Unclosed frontmatter");
          }
          const metadata: unknown = header ? parse(header[1]!) : {};
          if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Frontmatter must be a mapping");
          notes.set(name, { body: source.slice(header?.[0].length ?? 0), metadata: metadata as Record<string, unknown> });
        } catch (error) {
          notes.set(name, { body: "", metadata: {}, error: String(error) });
        }
      }
    }
  }
  visit("");
  return notes;
}

function links(body: string): { target: string; wiki: boolean }[] {
  const tree = fromMarkdown(body);
  const definitions = new Map<string, string>();
  const result: { target: string; wiki: boolean }[] = [];
  function walk(node: Root | RootContent, action: (node: Root | RootContent) => void) {
    action(node);
    if ("children" in node) for (const child of node.children) walk(child, action);
  }
  walk(tree, node => { if (node.type === "definition") definitions.set(node.identifier, node.url); });
  walk(tree, node => {
    if (node.type === "link" || node.type === "image") result.push({ target: node.url, wiki: false });
    if (node.type === "linkReference" || node.type === "imageReference") {
      const target = definitions.get(node.identifier);
      if (target) result.push({ target, wiki: false });
    }
    if (node.type === "text") {
      for (const match of node.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) result.push({ target: match[1]!.split("|")[0]!, wiki: true });
    }
  });
  return result;
}

function permitted(name: string, note: Note, entry: string, audience: Audience): boolean {
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
  return name.startsWith(path.posix.dirname(entry) + "/") && path.posix.basename(name) !== "index.md";
}

export function auditLore(root: string, entry: string, audience: Audience): Finding[] {
  const notes = readVault(root), findings: Finding[] = [];
  if (entry.split("/").some(part => part === "." || part === "..") || !/^Scenarios\/.+\/Characters\/[^/]+\/character\.md$/.test(entry)
    || path.posix.basename(path.posix.dirname(entry)) !== audience.character) throw new Error("Entry must be this character's Scenarios/.../Characters/<id>/character.md");
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
      let target: string;
      try { target = decodeURIComponent(link.target.split("#")[0]!.split("?")[0]!); }
      catch { findings.push({ kind: "broken", trail: [...trail, link.target], detail: "Invalid URL encoding" }); continue; }
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
      if (!link.wiki && path.posix.extname(target) && !target.endsWith(".md")) continue;
      if (!target.endsWith(".md")) target += ".md";
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      const absolute = path.posix.normalize(target.replace(/^\//, ""));
      const candidates = link.wiki
        ? (notes.has(absolute) ? [absolute] : notes.has(relative) ? [relative] : [...notes.keys()].filter(key => key.endsWith("/" + absolute)))
        : [link.target.startsWith("/") ? absolute : relative].filter(key => notes.has(key));
      if (candidates.length !== 1) findings.push({ kind: candidates.length ? "ambiguous" : "broken", trail: [...trail, link.target], detail: candidates.length ? `Matches: ${candidates.join(", ")}` : "No matching vault note (outside-vault paths are not followed)" });
      else queue.push([...trail, candidates[0]!]);
    }
  }
  return findings;
}
