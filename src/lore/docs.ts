import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { sessionDir } from "../runtime/session.ts";

/**
 * The docs service (V1's, rebuilt): linked Markdown lore with frontmatter.
 * - Authored lore lives in lore/ (Cast/<Name>/{private,public,gm,knowledge/*}.md, World/, Places/).
 * - Each session gets a copy-on-write overlay (runs/sessions/<id>/docs/): play edits the session's
 *   lore, never the authored seed.
 * - A character's memories live next to their lore entry: Cast/<Name>/memories/index.md plus one
 *   note per memory (V1's save_memory). Characters without lore get characters/<id>/memories/.
 * - Access fails closed: a character's scope sees public docs and private docs listing them as a
 *   reader; gm docs are the GM's own truth.
 */

export interface DocMeta {
  summary: string;
  title?: string;
  type?: string;
  visibility: "private" | "public" | "gm";
  readers?: string[];
  /** On a character's private.md: the scene cast id it belongs to. */
  character?: string;
  context?: string;
  scene?: string;
  turn?: number;
}

export interface Doc { path: string; meta: DocMeta; body: string }
export interface DocLink { path: string; from: string; title: string; summary: string; label: string }

const REPO = join(import.meta.dirname, "..", "..");
export const LORE_ROOT = join(REPO, "lore");
const overlay = (sessionId: string) => join(sessionDir(sessionId), "docs");

function inside(root: string, path: string): string {
  const full = normalize(join(root, path));
  if (!full.startsWith(root)) throw new Error(`Doc path escapes the store: ${path}`);
  return full;
}

/** Frontmatter as one key per line with JSON-compatible values (V1's YAML subset). */
function serialize(doc: Doc): string {
  const lines = Object.entries(doc.meta).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n${doc.body.trim()}\n`;
}

export function parseDoc(path: string, text: string): Doc {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { path, meta: { summary: "", visibility: "gm" }, body: text };
  const meta = Object.fromEntries(m[1]!.split("\n").filter(l => l.includes(":")).map(line => {
    const i = line.indexOf(":");
    const raw = line.slice(i + 1).trim();
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { value = raw.replace(/^["']|["']$/g, ""); }
    return [line.slice(0, i).trim(), value];
  })) as unknown as DocMeta;
  if (!meta.visibility) meta.visibility = "public";
  return { path, meta, body: m[2]!.trim() };
}

export function readDoc(sessionId: string, path: string): Doc | undefined {
  for (const root of [overlay(sessionId), LORE_ROOT]) {
    const f = inside(root, path);
    if (existsSync(f)) return parseDoc(path, readFileSync(f, "utf8"));
  }
  return undefined;
}

/** A doc as authored, before any session's play has touched it. */
export function seedDoc(path: string): Doc | undefined {
  const f = inside(LORE_ROOT, path);
  return existsSync(f) ? parseDoc(path, readFileSync(f, "utf8")) : undefined;
}

export function writeDoc(sessionId: string, doc: Doc): void {
  const f = inside(overlay(sessionId), doc.path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, serialize(doc));
}

function walk(root: string, dir = ""): string[] {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).flatMap(e => e.name.startsWith(".") ? [] : e.isDirectory() ? walk(root, join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []);
}

export function listDocs(sessionId: string, options: { sessionOnly?: boolean } = {}): string[] {
  return [...new Set([...walk(overlay(sessionId)), ...(options.sessionOnly ? [] : walk(LORE_ROOT))])].sort();
}

export const titleOf = (doc: Doc) => doc.meta.title ?? /^#\s+(.+)$/m.exec(doc.body)?.[1]?.trim() ?? basename(doc.path, ".md");

export function permitted(doc: Doc, scope: string): boolean {
  if (scope === "gm") return true;
  if (doc.meta.visibility === "gm") return false;
  if (doc.meta.visibility === "public") return true;
  return (doc.meta.readers ?? []).includes(scope);
}

/** Links in a doc: relative Markdown links (spaces and %20 allowed) and [[wiki links]] by file name. */
export function linksIn(sessionId: string, doc: Doc): DocLink[] {
  const links: DocLink[] = [];
  const add = (target: string, title: string, label: string) => {
    const linked = readDoc(sessionId, target);
    if (!linked || target === doc.path) return;
    links.push({ path: target, from: doc.path, title: titleOf(linked) || title, summary: linked.meta.summary ?? "", label });
  };
  // Targets may hold spaces and one level of balanced brackets ("Places/Heron Warehouse (truth).md").
  for (const m of doc.body.matchAll(/\[([^\]]+)\]\(<?((?:[^()<>\n]|\([^()\n]*\))+?\.md)>?\)(?:\s*[—-]\s*([^\n]+))?/g)) {
    let target = m[2]!.trim();
    try { target = decodeURIComponent(target); } catch { /* keep */ }
    add(normalize(join(dirname(doc.path), target)), m[1]!, m[3]?.trim() ?? "");
  }
  for (const m of doc.body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\](?:\s*[—-]\s*([^\n]+))?/g)) {
    const name = m[1]!.trim().toLowerCase();
    const hit = listDocs(sessionId).find(p => basename(p, ".md").toLowerCase() === name || p.toLowerCase().endsWith(`/${name}/index.md`));
    if (hit) add(hit, m[1]!, m[2]?.trim() ?? "");
  }
  return [...new Map(links.map(l => [l.path, l])).values()];
}

let registry: Map<string, string> | undefined;
/** Scene cast id -> the character's lore entry (private.md with `character: <id>`). */
export function characterEntry(id: string): string | undefined {
  if (!registry) {
    registry = new Map();
    for (const path of walk(LORE_ROOT)) {
      if (!path.endsWith("private.md")) continue;
      const doc = parseDoc(path, readFileSync(join(LORE_ROOT, path), "utf8"));
      if (doc.meta.character) registry.set(doc.meta.character, path);
    }
  }
  return registry.get(id);
}

export const memoryIndexPath = (id: string) => {
  const entry = characterEntry(id);
  return entry ? join(dirname(entry), "memories", "index.md") : `characters/${id}/memories/index.md`;
};
export const STORY_INDEX = "story/index.md";

/** The player character's own doc: who they are and what they've told or shown people (the GM's record). */
export const playerDocPath = (name: string) => `Player/${name.replace(/[^\w' -]/g, "").trim() || "Player"}.md`;
export function playerDoc(sessionId: string, player: { name: string; concept: string }): Doc {
  const path = playerDocPath(player.name);
  const existing = readDoc(sessionId, path);
  if (existing) return existing;
  const doc: Doc = { path, meta: { summary: `The player character, ${player.name}: who they are, and what they've told or shown people about themselves (their past, family, origins, claims).`, type: "character", visibility: "gm" }, body: `# ${player.name}\n\n${player.concept}\n\n## What they've told or shown people about themselves` };
  writeDoc(sessionId, doc);
  return doc;
}

/** A character's memory index, private to them (V1's seedMemories). */
export function memoryIndex(sessionId: string, id: string, name: string): Doc {
  const path = memoryIndexPath(id);
  const existing = readDoc(sessionId, path);
  if (existing) return existing;
  const doc: Doc = { path, meta: { summary: `An index of ${name}'s saved memories and the context in which they were recorded.`, type: "index", visibility: "private", readers: [`character:${id}`] }, body: "# Memories" };
  writeDoc(sessionId, doc);
  return doc;
}

const escapeLink = (text: string) => text.replace(/\s+/g, " ").replace(/[[\]()]/g, "");

function appendLink(sessionId: string, index: Doc, target: string, title: string, context: string): void {
  const rel = target.startsWith(dirname(index.path) + "/") ? target.slice(dirname(index.path).length + 1) : target;
  writeDoc(sessionId, { ...index, body: `${index.body.trimEnd()}\n- [${escapeLink(title)}](${rel.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")}) — ${escapeLink(context)}` });
}

export interface MemoryInput { title: string; context: string; content: string }

/** V1's save_memory: a separate private note, linked from the character's index. */
export function saveMemory(sessionId: string, character: { id: string; name: string }, memory: MemoryInput, origin: { scene: string; turn: number }): string {
  for (const key of ["title", "context", "content"] as const) if (typeof memory[key] !== "string" || !memory[key].trim()) throw new Error(`Memory requires ${key}.`);
  const index = memoryIndex(sessionId, character.id, character.name);
  const path = join(dirname(index.path), `${randomUUID().slice(0, 8)}.md`);
  const title = memory.title.trim(), context = memory.context.trim();
  writeDoc(sessionId, { path, meta: { title, context, summary: `${title}: ${context}`, type: "memory", visibility: "private", readers: [`character:${character.id}`], scene: origin.scene, turn: origin.turn }, body: memory.content.trim() });
  appendLink(sessionId, index, path, title, context);
  return path;
}

export function storyIndex(sessionId: string): Doc {
  const existing = readDoc(sessionId, STORY_INDEX);
  if (existing) return existing;
  const doc: Doc = { path: STORY_INDEX, meta: { summary: "Scenes played so far in this story, and how each ended.", type: "index", visibility: "gm" }, body: "# The story so far" };
  writeDoc(sessionId, doc);
  return doc;
}

/** What happened in a played scene (the hand-off), for the GM of later scenes. */
export function savePlayedScene(sessionId: string, scene: { id: string; title: string }, ending: string, body: string): string {
  const index = storyIndex(sessionId);
  const path = `story/scenes/${scene.id}.md`;
  writeDoc(sessionId, { path, meta: { title: scene.title, context: `played; ended: ${ending}`, summary: `${scene.title}: what happened when it was played, and how it ended (${ending}).`, type: "story", visibility: "gm", scene: scene.id }, body });
  appendLink(sessionId, index, path, scene.title, `played; ended: ${ending}`);
  return path;
}

/** A shared fact as its own note (the lite alternative; V1-style reviews edit the lore instead). */
export function saveFact(sessionId: string, fact: MemoryInput, origin: { scene: string; turn: number }): string {
  const index = storyIndex(sessionId);
  const path = `story/facts/${randomUUID().slice(0, 8)}.md`;
  writeDoc(sessionId, { path, meta: { title: fact.title.trim(), context: fact.context.trim(), summary: `${fact.title.trim()}: ${fact.context.trim()}`, type: "fact", visibility: "public", scene: origin.scene, turn: origin.turn }, body: fact.content.trim() });
  appendLink(sessionId, index, path, fact.title, fact.context);
  return path;
}

export function memoryLines(sessionId: string, id: string): string[] {
  const index = readDoc(sessionId, memoryIndexPath(id));
  return index ? index.body.split("\n").filter(l => l.startsWith("- [")) : [];
}

/** Keyword search over the session's lore (overlay and seed), with snippets. Not relevance-ranked. */
export function searchDocs(sessionId: string, query: string, scope = "gm", limit = 12): Array<{ path: string; title: string; summary: string; snippet: string }> {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const hits: Array<{ path: string; title: string; summary: string; snippet: string; score: number }> = [];
  for (const path of listDocs(sessionId)) {
    const doc = readDoc(sessionId, path)!;
    if (!permitted(doc, scope)) continue;
    const text = `${titleOf(doc)} ${doc.meta.summary} ${doc.body}`.toLowerCase();
    const score = words.filter(w => text.includes(w)).length;
    if (!score) continue;
    const at = Math.max(0, text.indexOf(words.find(w => text.includes(w))!) - 60);
    hits.push({ path, title: titleOf(doc), summary: doc.meta.summary, snippet: `${doc.meta.summary} ${doc.body}`.replace(/\s+/g, " ").slice(at, at + 200), score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...h }) => { void score; return h; });
}

/** Exact-text edit of a doc (copy-on-write into the session overlay). */
export function editDoc(sessionId: string, path: string, oldText: string, newText: string): void {
  const doc = readDoc(sessionId, path);
  if (!doc) throw new Error(`No doc at ${path}`);
  const count = doc.body.split(oldText).length - 1;
  if (count !== 1) throw new Error(count ? `old_text matches ${count} places; include more context` : "old_text not found in the doc body");
  writeDoc(sessionId, { ...doc, body: doc.body.replace(oldText, newText) });
}

export function createDoc(sessionId: string, path: string, meta: DocMeta, body: string): void {
  if (readDoc(sessionId, path)) throw new Error(`A doc already exists at ${path}; edit it instead`);
  if (!path.endsWith(".md")) throw new Error("Doc paths end in .md");
  writeDoc(sessionId, { path, meta, body });
}
