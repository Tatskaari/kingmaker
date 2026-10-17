// Copied from the scratchpad's tools/convert-hanged-clerk.mts (sections, items, loadScene) at 44c6d4a; the file reads are taken out (`words` reads them), and an exit keeps its effects.

import type { CastFile, RouteFile, SceneFile } from "./files.ts";
import type { Beat, Character, Exit, Scene, Transition } from "./types.ts";

/**
 * A scene.json and its Markdown back into the prototype's Scene, so the copied GM code runs on it
 * unchanged. Fact ids become their sentences (what `established` holds, content-world A7).
 *
 * Without `words` it's the structure alone, every Markdown field empty: what the simulation has.
 * With it, every file must be there: `words(path)` is a file's text by its path in the scene's
 * folder ("setting.md", "cast/kell.md"), or undefined when there's no such file.
 */
export function sceneOf(file: SceneFile, words?: (path: string) => string | undefined): Scene {
  const read = reader(file, words);
  const fact = factOf(file);

  return {
    id: file.id, title: file.title, ...(file.time ? { time: file.time } : {}), summary: file.summary,
    setting: text(read("setting.md")), premise: text(read("premise.md")), hook: text(read("hook.md")), opening: text(read("opening.md")),
    cast: file.cast.map(c => characterOf(c, read, file.id)),
    start: file.start,
    beats: Object.entries(file.beats).map(([id, b]) => beatOf(id, b, read, fact, file.id)),
    ...(file.anytime.length ? { anytime: file.anytime.map(r => transitionOf(r, fact)) } : {}),
    exits: Object.entries(file.exits).map(([id, e]) => exitOf(id, e, read)),
    ...(Object.keys(file.essentials).length ? { essentials: Object.entries(file.essentials).map(([id, e]) => ({ id, ...e })) } : {}),
    limits: items(read("limits.md")),
    lore: file.lore, ...(file.fronts ? { fronts: file.fronts } : {}),
    ...(file.afterwards.length ? { afterwards: file.afterwards } : {}),
  };
}

/** A Markdown file as sections: the body before the first `## ` (an H1 ignored), then each `## Title`. */
export function sections(md: string): { lead: string; parts: Map<string, string> } {
  const text = md.replace(/\r\n/g, "\n").replace(/^# [^\n]*\n+/, "");
  const rest = text.split(/^(?=## )/m);
  // (A zero-width match at the very start doesn't split: a file that opens on "## " has no lead.)
  const lead = rest[0]?.startsWith("## ") ? "" : rest.shift();
  const parts = new Map<string, string>();
  for (const s of rest) { const nl = s.indexOf("\n"); parts.set(s.slice(3, nl < 0 ? undefined : nl).trim(), (nl < 0 ? "" : s.slice(nl + 1)).trim()); }
  return { lead: (lead ?? "").trim(), parts };
}

/** A bullet list: each `- ` line is an item; following lines that aren't a new item continue it. */
export function items(body: string | undefined): string[] {
  const out: string[] = [];
  for (const line of (body ?? "").split("\n")) {
    if (/^\s*-\s+/.test(line)) out.push(line.replace(/^\s*-\s+/, "").trim());
    else if (line.trim() && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The parts.

/** A file's text, or undefined when the scene is loaded without its words. */
type Read = (path: string) => string | undefined;
type Fact = (id: string) => string;

/** With words, a missing file is an error; without them, every file is undefined. */
function reader(file: SceneFile, words?: (path: string) => string | undefined): Read {
  if (!words) return () => undefined;
  return path => {
    const found = words(path);
    if (found === undefined) throw new Error(`${file.id}: no ${path}`);
    return found;
  };
}

const text = (md: string | undefined) => (md ?? "").trim();

function factOf(file: SceneFile): Fact {
  return id => {
    const text = file.facts[id];
    if (text === undefined) throw new Error(`${file.id}: unknown fact ${id}`);
    return text;
  };
}

function transitionOf(r: RouteFile, fact: Fact): Transition {
  return {
    id: r.id, when: r.when, on: r.on,
    ...(r.to ? { to: r.to } : {}),
    ...(r.check ? { check: {
      skill: r.check.skill, dc: r.check.dc, ...(r.check.reason ? { reason: r.check.reason } : {}),
      success: r.check.success, failure: r.check.failure, onSuccess: r.check.onSuccess,
      ...(r.check.onFailure ? { onFailure: r.check.onFailure } : {}),
      ...(r.check.establishes ? { establishes: Object.fromEntries(Object.entries(r.check.establishes).map(([k, v]) => [k, v.map(fact)])) } : {}),
    } } : {}),
    ...(r.establishes ? { establishes: r.establishes.map(fact) } : {}),
    ...(r.given ? { given: true } : {}), ...(r.essential ? { essential: r.essential } : {}), ...(r.towards ? { towards: r.towards } : {}),
  };
}

/** A cast member: the structure from scene.json, the words from their card (each required section checked when there are words). */
function characterOf(c: CastFile, read: Read, sceneId: string): Character {
  const card = read(c.card);
  const { parts } = sections(card ?? "");
  const need = (k: string) => {
    const v = parts.get(k);
    if (v === undefined && card !== undefined) throw new Error(`${sceneId}: ${c.card} has no "## ${k}"`);
    return v ?? "";
  };
  return {
    id: c.id, name: c.name, look: need("Look"),
    ...(c.called ? { called: c.called } : {}), ...(c.aka ? { aka: c.aka } : {}),
    voice: need("Voice"), wants: need("Wants"), ...(parts.has("Fears") ? { fears: parts.get("Fears")! } : {}),
    knows: items(need("Knows")), ...(parts.has("Secrets") ? { secrets: items(parts.get("Secrets")) } : {}),
    attitude: need("Attitude"),
    ...(c.enters ? { enters: c.enters } : {}), ...(c.group ? { group: c.group } : {}),
    ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}), ...(c.members ? { members: c.members } : {}),
  };
}

/** A beat: its direction (the file's lead), the notes on the cast and the pressure, and its routes. */
function beatOf(id: string, b: SceneFile["beats"][string], read: Read, fact: Fact, sceneId: string): Beat {
  const { lead, parts } = sections(read(b.text) ?? "");
  const castNotes = items(parts.get("Cast")).map(i => {
    const m = /^([\w-]+):\s*(.*)$/.exec(i);
    if (!m) throw new Error(`${sceneId}: ${b.text} cast note "${i.slice(0, 40)}" isn't "<cast id>: note"`);
    return [m[1]!, m[2]!] as const;
  });
  return {
    id, title: b.title, direction: lead,
    ...(castNotes.length ? { cast: Object.fromEntries(castNotes) } : {}),
    ...(parts.has("Pressure") ? { pressure: parts.get("Pressure")! } : {}),
    transitions: b.routes.map(r => transitionOf(r, fact)),
  };
}

function exitOf(id: string, e: SceneFile["exits"][string], read: Read): Exit {
  const { parts } = sections(read(e.text) ?? "");
  return { id, kind: e.kind, title: e.title, outcome: parts.get("Outcome") ?? "", closing: parts.get("Closing") ?? "", ...(e.next ? { next: e.next } : {}), effects: e.effects };
}
