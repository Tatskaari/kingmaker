// Copied from the scratchpad's tools/convert-hanged-clerk.mts (sections, items, loadScene) at 44c6d4a; the file reads are taken out (`words` reads them), an exit keeps its effects, and the story's fields (interlude, assumes, overtaken, rest, milestone, background, onEnd: story-design §4.2) and a talk's companion (town-design §3.6) are carried.

import { isBeat, isEnding, isStart, parseScene, type BeatData, type CastMember, type EndingData, type Route, type SceneDocument, type SceneNode, type StartData } from "./document.ts";
import type { CastFile, RouteFile, SceneFile } from "./files.ts";
import { TOLD } from "./talk.ts";
import type { Beat, Character, Essential, Exit, Scene, SceneRoute, Transition } from "./types.ts";

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
    ...(file.interlude ? { interlude: true } : {}),
    ...(file.assumes?.length ? { assumes: file.assumes } : {}), ...(file.overtaken ? { overtaken: file.overtaken } : {}),
    ...(file.rest ? { rest: file.rest } : {}), ...(file.milestone ? { milestone: true } : {}),
    ...(file.background?.length ? { background: file.background } : {}),
    ...(file.onEnd?.length ? { onEnd: file.onEnd } : {}),
    ...(file.companion ? { companion: file.companion } : {}),
    routes: [],
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

// ---------------------------------------------------------------------------------------------
// The scene format (document.ts) as the runtime's Scene (M2).

/**
 * A scene file as the runtime's Scene, with all its words: the prototype's shape the copied GM code
 * reads, and what the scene format adds beside it (docs/scene-format.md). The start and the beats
 * are its beats, in the file's order, each with the routes that leave it as its transitions (the
 * copied code's: a route's condition is its `when`, a fact its sentence; a dice route an attempt
 * with its check; into a discovery with no condition, its revelation landing); the endings its exits;
 * the start's description its opening; every route, flat, its routes; and each beat with `carry` an
 * essential (its id the beat's, what it is its revelation, where it's placed its paths' `via`), so
 * the story's boundary and what it owes keep working. A talk (the template, with `companion`) has
 * its ways into its ending as anytime attempts, as the template's goodbye was: the player's farewell
 * is judged before the reply, whichever beat the talk is at. Its way into told (TOLD) is the talk's
 * own to give, worded for each talk from what it may bring out (ai/gm/talk.ts prepareTalk's route,
 * CONFIDED): the template's stands for it in the file, and isn't one of the beat's transitions.
 */
export function sceneOfDocument(doc: SceneDocument): Scene {
  const start = doc.nodes.find(isStart)!;
  const facts = doc.facts ?? {};
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  const castIds = new Set(doc.cast.map(c => c.id));
  const routes = doc.edges.map(routeOf);
  const talk = doc.companion !== undefined;
  const intoEnding = (r: SceneRoute) => nodes.get(r.target)?.data.kind === "exit";
  const toTransition = (r: SceneRoute) => transitionOfRoute(r, nodes, facts, talk && intoEnding(r));
  const leaves = (n: SceneNode, r: SceneRoute) => r.source === n.id && !(talk && (intoEnding(r) || r.target === TOLD));
  const beats = doc.nodes.filter((n): n is SceneNode<StartData | BeatData> => !isEnding(n))
    .map(n => beatOfNode(n, routes.filter(r => leaves(n, r)).map(toTransition)));
  const anytime = talk ? routes.filter(intoEnding).map(toTransition) : [];
  const essentials = doc.nodes.filter(isBeat).flatMap(n => (n.data.carry ? [essentialOf(n, castIds)] : []));

  return {
    id: doc.id, title: doc.title, ...(doc.time ? { time: doc.time } : {}), summary: doc.description,
    setting: doc.setting, premise: doc.premise, hook: doc.hook, opening: start.data.description,
    cast: doc.cast.map(characterOfMember),
    start: start.id,
    beats,
    ...(anytime.length ? { anytime } : {}),
    exits: doc.nodes.filter(isEnding).map(exitOfNode),
    ...(essentials.length ? { essentials } : {}),
    limits: [...(doc.limits ?? [])],
    lore: [...doc.lore], ...(doc.fronts ? { fronts: doc.fronts } : {}),
    ...(doc.known?.length ? { known: [...doc.known] } : {}),
    // (Every op of afterwards names what it acts on: the parse holds it to that.)
    ...(doc.afterwards?.length ? { afterwards: doc.afterwards as NonNullable<Scene["afterwards"]> } : {}),
    ...(doc.interlude ? { interlude: true } : {}),
    ...(doc.assumes?.length ? { assumes: [...doc.assumes] } : {}), ...(doc.overtaken ? { overtaken: doc.overtaken } : {}),
    ...(doc.rest ? { rest: doc.rest } : {}), ...(doc.milestone ? { milestone: true } : {}),
    ...(doc.background?.length ? { background: [...doc.background] } : {}),
    ...(doc.onEnd?.length ? { onEnd: doc.onEnd } : {}),
    ...(doc.companion ? { companion: doc.companion } : {}),
    truth: doc.truth,
    ...(doc.clock ? { clock: doc.clock } : {}),
    facts: { ...facts },
    routes,
  };
}

/** A .kmscene file's text as the runtime's Scene: parsed (a SceneFormatError naming `where` when it isn't a scene), then made one. */
export const loadScene = (text: string, where?: string): Scene => sceneOfDocument(parseScene(text, where));

function routeOf(e: Route): SceneRoute {
  const d = e.data;
  return {
    id: e.id, source: e.source, target: e.target, label: e.label, condition: d.condition, phase: d.phase,
    ...(d.requires?.length ? { requires: [...d.requires] } : {}),
    ...(d.skill ? { skill: d.skill, dc: d.dc } : {}),
    ...(d.onFailure ? { onFailure: d.onFailure } : {}),
    ...(d.establishes?.length ? { establishes: [...d.establishes] } : {}),
  };
}

/**
 * A route as the copied code's transition. Its condition is its `when` (into a discovery with none,
 * the revelation landing); a cue is a cue; dice make it an attempt with a check, success to its
 * target and failure to `onFailure` (its facts settled on success); anything else is an outcome,
 * judged after the reply, unless `attempt` (a talk's farewell).
 */
function transitionOfRoute(r: SceneRoute, nodes: Map<string, SceneNode>, facts: Record<string, string>, attempt: boolean): Transition {
  const target = nodes.get(r.target)!;
  const title = (id: string) => nodes.get(id)?.data.title ?? id;
  const revelation = target.data.kind === "beat" ? target.data.revelation : undefined;
  const when = r.condition.trim() || (revelation !== undefined ? `The player has come to understand this: ${revelation}` : r.label);
  const sentences = (r.establishes ?? []).map(id => facts[id] ?? id);
  const common = { id: r.id, when, ...(r.requires ? { requires: [...r.requires] } : {}) };
  if (r.skill) {
    return {
      ...common, on: "attempt",
      check: {
        skill: r.skill, dc: r.dc ?? 10,
        success: `It comes off: ${title(r.target)}.`,
        failure: r.onFailure ? `It goes wrong: ${title(r.onFailure)}.` : "It doesn't come off, and the scene stays where it is.",
        onSuccess: r.target, ...(r.onFailure ? { onFailure: r.onFailure } : {}),
        ...(sentences.length ? { establishes: { success: sentences } } : {}),
      },
    };
  }
  return { ...common, on: r.phase === "cue" ? "cue" : attempt ? "attempt" : "outcome", to: r.target, ...(sentences.length ? { establishes: sentences } : {}) };
}

function beatOfNode(n: SceneNode<StartData | BeatData>, transitions: Transition[]): Beat {
  const d = n.data;
  const beat = d.kind === "beat" ? d : undefined;
  return {
    id: n.id, title: d.title, direction: d.description,
    ...(d.cast && Object.keys(d.cast).length ? { cast: { ...d.cast } } : {}),
    ...(beat?.pressure ? { pressure: beat.pressure } : {}),
    transitions,
    ...(beat?.revelation !== undefined ? { revelation: beat.revelation } : {}),
    ...(beat?.paths ? { paths: beat.paths.map(p => ({ ...p, ...(p.check ? { check: { ...p.check } } : {}) })) } : {}),
    ...(beat?.required ? { required: true } : {}),
    ...(beat?.establishes?.length ? { establishes: [...beat.establishes] } : {}),
    ...(beat?.carry ? { carry: { ...beat.carry, ...(beat.carry.things ? { things: [...beat.carry.things] } : {}) } } : {}),
    ...(d.lore.length ? { lore: [...d.lore] } : {}),
  };
}

function exitOfNode(n: SceneNode<EndingData>): Exit {
  const d = n.data;
  return {
    id: n.id, kind: d.exitKind, title: d.title, outcome: d.description, closing: d.closing,
    ...(d.next ? { next: d.next } : {}), effects: [...(d.effects ?? [])], result: d.result,
    ...(d.lore.length ? { lore: [...d.lore] } : {}),
  };
}

function characterOfMember(c: CastMember): Character {
  return {
    id: c.id, name: c.name, look: c.look,
    ...(c.called ? { called: c.called } : {}), ...(c.aka?.length ? { aka: [...c.aka] } : {}),
    voice: c.voice, wants: c.wants, ...(c.fears ? { fears: c.fears } : {}),
    knows: [...c.knows], ...(c.secrets?.length ? { secrets: [...c.secrets] } : {}),
    attitude: c.attitude,
    ...(c.enters ? { enters: c.enters } : {}), ...(c.group ? { group: c.group } : {}),
    ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}),
    ...(c.members ? { members: c.members.map(m => ({ ...m })) } : {}),
    whyHere: c.whyHere, ...(c.limits ? { limits: c.limits } : {}), ...(c.roles ? { roles: { ...c.roles } } : {}), ...(c.lore ? { lore: c.lore } : {}),
  };
}

/** A beat the rest of the story needs (`carry`) as the essential the boundary owes on when it's missed. */
function essentialOf(n: SceneNode<BeatData>, castIds: Set<string>): Essential {
  const d = n.data, carry = d.carry!;
  const vias = [...new Set((d.paths ?? []).map(p => p.via))];
  return {
    id: n.id, what: d.revelation ?? d.description, placedWith: vias, carriers: vias.filter(v => castIds.has(v)), unlocks: carry.unlocks,
    ...(carry.later ? { later: carry.later } : {}), ...(carry.things?.length ? { things: [...carry.things] } : {}),
  };
}
