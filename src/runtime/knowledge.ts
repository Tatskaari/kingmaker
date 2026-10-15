import { basename } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { talkOf } from "../../scenes/talk.ts";
import { listDocs, playerDocPath, readDoc, seedDoc, titleOf, type Doc } from "../lore/docs.ts";
import { knownCast, nameTokens, presentCast } from "./brief.ts";
import type { Mark, MarkLink, Markup } from "./markup.ts";
import type { Scene } from "./scene.ts";
import type { Entry, SessionState } from "./session.ts";
import { distinct, speaker, type Speaker } from "./speakers.ts";

/**
 * What the player knows: what a mark's note may explain (src/runtime/markup.ts), and what a mark's
 * popover may show. The GM is given every fact in its prep, secrets and all (a fast model kept from
 * a fact invents one: docs/guide); this says which of them the player has, so a note can explain
 * without telling a secret. It's built from what the player has lived, never from the prep:
 *
 * - who they are: their concept, and their doc (Player/<Name>.md: what they've told or shown people
 *   of themselves, and their backstory once character creation writes one into it);
 * - the story so far as they lived it: how each scene ended, and the notebook's lines its ending wrote;
 * - this scene: everything said and shown in it;
 * - what companions have told them of themselves in talks between scenes;
 * - whose names they've heard (knownCast), and who they know only by sight;
 * - the world's common knowledge: the lore marked public.
 *
 * What's behind the screen is everything else: people's secrets, what someone is keeping back, what
 * a scene means the player to find, the GM-only and private notes, a companion's untold stories.
 */

export interface PlayerKnowledge {
  /** Their own doc, where their past is kept, when there is one. */
  self?: string;
  /** Earlier scenes, oldest first: the scene, how it ended, and what the notebook says of it. */
  scenes: Array<{ id: string; title: string; ending: string; notebook: string[] }>;
  /** What companions have told them of their own story, in talks. */
  told: Array<{ who: string; topic: string }>;
}

const safeScene = (id: string): Scene | undefined => { try { return sceneById(id); } catch { return undefined; } };

/** What the player knows of the story so far (this scene is the conversation itself). */
export function playerKnowledge(state: SessionState): PlayerKnowledge {
  const self = readDoc(state.id, playerDocPath(state.player.name));
  return {
    ...(self ? { self: self.path } : {}),
    scenes: state.history.filter(h => !talkOf(h.sceneId)).map(h => {
      const played = safeScene(h.sceneId);
      return { id: h.sceneId, title: played?.title ?? h.sceneId, ending: played?.exits.find(e => e.id === h.exitId)?.title ?? h.exitId, notebook: h.journal ?? [] };
    }),
    told: Object.entries(state.talks ?? {}).flatMap(([id, record]) => record.told.map(t => ({ who: companionName(state, id), topic: t.topic }))),
  };
}

/** A companion's name as the story has it: on the card of any scene that has them, else their id. */
function companionName(state: SessionState, id: string): string {
  for (const sceneId of [state.sceneId, ...state.history.map(h => h.sceneId)]) {
    const c = safeScene(sceneId)?.cast.find(x => x.id === id);
    if (c) return c.name;
  }
  return id;
}

/**
 * The GM's note of what the player knows, in its prep (stable for the scene): what a mark may
 * explain, and what stays behind the screen. Whose names they've heard changes as the scene goes,
 * so that's in the turn's own note ("Names the player hasn't heard yet").
 */
export function knowledgeBrief(state: SessionState): string {
  const k = playerKnowledge(state);
  const lines = [
    `- Who they are: ${state.player.name}, ${state.player.concept.replace(/\.$/, "")}. Their own past, as your notes on the player character have it${k.self ? ` (${k.self})` : ""}, is theirs: they know all of it.`,
    ...(k.scenes.length ? [`- What they did and saw earlier in the story (everything that was narrated to them):\n${k.scenes.map(s => `  - ${s.title}: ${s.ending}.${s.notebook.length ? ` Their notebook: ${s.notebook.map(n => `"${n}"`).join(" ")}` : ""}`).join("\n")}`] : []),
    ...(k.told.length ? [`- What people have told them of themselves, between scenes: ${k.told.map(t => `${t.who}, ${t.topic}`).join("; ")}.`] : []),
    "- This scene: everything said and shown so far, and everything they've done in it.",
    "- The world: what anyone in Caerwyn knows (the city and its places, its customs and laws, who's who: your lore notes marked public), and what their trade and their past would have taught them.",
  ];
  return [
    "## What the player knows",
    "A note on a mark (your instructions say how to mark things) explains from this and nothing else. Everything else in your prep stays behind the screen however much it would explain: people's secrets and what they're keeping back, how far anyone has opened up, what the scene still means the player to find, your GM-only notes and other people's private ones, a story someone hasn't told yet, and the names the player hasn't heard. Play from all of it as ever: just don't explain it in a note.",
    ...lines,
  ].join("\n");
}

// --- Who speaks: the scene's people by the names that mean them in prose.

/** Everyone who might speak in a reply: the scene's cast (those here first), then the rest of the place's people. */
export function speakersOf(scene: Scene, state: SessionState): Speaker[] {
  const here = presentCast(scene, state);
  const cast = [...here, ...scene.cast.filter(c => !here.includes(c))];
  const out: Speaker[] = cast.map(c => speaker(c.id, c.name, c.called, c.aka));
  for (const e of Object.values(state.world?.entities ?? {})) {
    if ((e.kind !== "person" && e.kind !== "creature") || e.player || e.states.includes("gone") || out.some(p => p.id === e.id || p.id === e.cast)) continue;
    out.push(speaker(e.id, e.name));
  }
  return distinct(out);
}

/** Someone by the name the player knows them by (what they call them, until they've heard it). */
export function nameAsKnown(scene: Scene, state: SessionState, id: string): string | undefined {
  const c = scene.cast.find(x => x.id === id);
  if (c) return c.called && !knownCast(scene, state).has(c.id) ? c.called : c.name;
  return state.world?.entities[id]?.name;
}

// --- Marks: linking each to what the player knows, and keeping names they haven't heard out of it.

/** Words too common to tell one deed from another. */
const STOP = new Set(["that", "this", "with", "from", "your", "you're", "they", "them", "their", "there", "then", "than", "have", "been", "were", "what", "when", "where", "which", "while", "would", "could", "should", "about", "into", "just", "only", "very", "some", "said", "says", "will", "it's", "isn't", "don't", "didn't", "here", "over", "back", "down", "still", "made", "make", "like", "know", "knows"]);
/** A word's stem, roughly ("throwing", "throws" and "thrown" are all "throw"; "stones" is "stone"). */
const stem = (w: string) => w.replace(/(?:ing|ed|es|s|ly|n)$/, "").replace(/(.)\1$/, "$1");
const contentWords = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z'’]{3,}/g) ?? []).map(w => w.replace(/[’']s$/, "")).filter(w => !STOP.has(w)).map(stem).filter(w => w.length >= 3));

/** The player's own turns in the session, newest first. */
const deeds = (state: SessionState) => state.transcript.filter(e => e.kind === "player").reverse();

/**
 * The player's turn a note is about: the one sharing the most words with it (two at least, or a
 * long one; one will do among their last few turns in this scene), the more recent the likelier.
 */
export function deedFor(state: SessionState, text: string): Entry | undefined {
  const words = contentWords(text);
  const all = deeds(state);
  const recent = new Set(all.filter(e => (e.scene ?? state.sceneId) === state.sceneId).slice(0, 4));
  let best: { e: Entry; score: number } | undefined;
  for (const e of all) {
    const shared = [...contentWords(e.text)].filter(w => words.has(w));
    const score = shared.length + shared.filter(w => w.length >= 6).length * 0.5 + (recent.has(e) ? 0.5 : 0);
    const enough = shared.length >= 2 || shared.some(w => w.length >= 6) || (shared.length === 1 && recent.has(e));
    if (enough && (!best || score > best.score)) best = { e, score };
  }
  return best?.e;
}

interface Person { id: string; names: RegExp[] }

/** The people the player can know by a name: the scene's cast they've heard named, what they call the rest, and the place's people. */
function people(scene: Scene, state: SessionState): Person[] {
  const known = knownCast(scene, state);
  const out: Person[] = presentCast(scene, state).map(c => ({
    id: c.id,
    names: [...(known.has(c.id) ? [c.name, ...nameTokens(c)] : []), ...(c.called ? [c.called.replace(/^(the|a|an)\s+/i, "")] : [])].map(n => new RegExp(`\\b${escape(n)}\\b`, known.has(c.id) ? "" : "i")),
  }));
  for (const e of Object.values(state.world?.entities ?? {})) {
    if ((e.kind !== "person" && e.kind !== "creature") || e.player || out.some(p => p.id === e.id || p.id === e.cast)) continue;
    const name = e.name.replace(/^(the|a|an)\s+/i, "");
    if (name.length >= 3) out.push({ id: e.id, names: [new RegExp(`\\b${escape(name)}\\b`, "i")] });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a public lore doc is called in prose. */
interface LoreKey { path: string; keys: RegExp[] }
let loreIndex: LoreKey[] | undefined;
/** Last words of a name too common to stand for it alone ("the office", "the road"). */
const COMMON_TAIL = /^(Office|Notes|Stairs|Square|Crisis|Road|Yard|House|Kitchens|Now|Docks)$/;

/**
 * The lore anyone could read (the authored public docs of the world and its places), by what
 * they're called: the title and the file's name, either without its first word ("the Purveyor's
 * office", "the Assembly"), and a proper last word alone ("the Watch", "the Rat"). A name of
 * several words is matched in any case; one word only as a proper name.
 */
function publicLore(): LoreKey[] {
  if (loreIndex) return loreIndex;
  loreIndex = [];
  // A session that doesn't exist: the authored lore alone.
  for (const path of listDocs("(authored lore)", { sessionOnly: false })) {
    if (!/^(World|Places)\//.test(path)) continue;
    const doc = seedDoc(path);
    if (!doc || doc.meta.visibility !== "public") continue;
    const names = [titleOf(doc), basename(path, ".md")].map(t => t.replace(/^(the|a|an)\s+/i, "").replace(/\s*\(.*\)$/, "").replace(/\s+and the .*$/i, "").trim());
    const keys = new Set<string>();
    for (const n of names) {
      const w = n.split(/\s+/);
      keys.add(n);
      if (w.length > 2) keys.add(w.slice(1).join(" "));
      if (w.length >= 2 && /^[A-Z][a-z']{2,}$/.test(w.at(-1)!) && !COMMON_TAIL.test(w.at(-1)!)) keys.add(w.at(-1)!);
    }
    loreIndex.push({ path, keys: [...keys].filter(k => k.length >= 3).map(k => new RegExp(`\\b${escape(k)}\\b`, /\s/.test(k) ? "i" : "")) });
  }
  return loreIndex;
}

/** The lore doc a phrase names, the scene's own first (and those in any case: in its scene, "the watch" is the City Watch). */
function loreFor(scene: Scene, text: string): string | undefined {
  const all = publicLore();
  const own = (l: LoreKey) => !!scene.lore?.includes(l.path);
  const ordered = [...all.filter(own), ...all.filter(l => !own(l))];
  return ordered.find(l => l.keys.some(k => k.test(text) || (own(l) && new RegExp(k.source, "i").test(text))))?.path;
}

/**
 * Each mark's link to what the player knows, where it names one and has none yet: their own past
 * act (a `you` note, or a `why` note about something they did), someone they know, or a place or
 * custom of the world anyone could read about. The phrase is looked at before the note; a lore doc
 * only by the phrase (a note that mentions the city in passing isn't about the city).
 */
export function linkMarks(markup: Markup, text: string, scene: Scene, state: SessionState): Markup {
  const who = people(scene, state);
  const marks = markup.marks.map((m): Mark => {
    if (m.link) return m;
    const phrase = text.slice(m.start, m.end);
    const deed = m.kind === "you" || (m.kind === "why" && /\byou\b/i.test(m.note)) ? deedFor(state, `${phrase} ${m.note}`) : undefined;
    const person = [phrase, m.note].map(s => who.find(p => p.names.some(n => n.test(s)))).find(Boolean);
    const lore = loreFor(scene, phrase);
    const link: MarkLink | undefined = deed ? { kind: "deed", scene: deed.scene ?? state.sceneId, turn: deed.turn }
      : person ? { kind: "person", id: person.id }
      : lore ? { kind: "lore", path: lore }
      : undefined;
    return link ? { ...m, link } : m;
  });
  return { ...markup, marks };
}

/**
 * A note never names someone the player hasn't heard named: their name gives way to what the
 * player calls them (the fast GM slips, and a popover is no place for it to show).
 */
export function unheardNames(markup: Markup, scene: Scene, state: SessionState): Markup {
  const marks = markup.marks.map(m => {
    const note = asKnown(m.note, scene, state);
    return note === m.note ? m : { ...m, note };
  });
  return { ...markup, marks };
}

/** Words with every name the player hasn't heard put as what they'd call its owner ("Nan Quill" is "the landlady"). */
export function asKnown(words: string, scene: Scene, state: SessionState): string {
  const known = knownCast(scene, state);
  const strangers = scene.cast.filter(c => c.called && !known.has(c.id));
  if (!strangers.length) return words;
  let out = words;
  for (const c of strangers) {
    // With any title before it ("Mrs Quill" is the landlady too).
    for (const n of [c.name, ...nameTokens(c)]) out = out.replace(new RegExp(`\\b(?:(?:Mrs|Mr|Miss|Ms|Master|Mister|Missus|Madam|Sergeant|Corporal|Captain|Big|Old|Young|Little)\\.?\\s+)?${escape(n)}\\b`, "g"), c.called!);
  }
  if (out === words) return words;
  return out.replace(/(^|[.!?]\s+|\n#*\s*)(the|a|an)\b/g, (_, lead: string, art: string) => `${lead}${art.charAt(0).toUpperCase()}${art.slice(1)}`);
}

// --- What a mark's popover shows of its link: only ever what the player knows.

/** A knowledge entry as the popover shows it. */
export interface Card { title: string; lines: string[] }

/**
 * What a doc says first, for a reader: the first paragraph of its body, its first sentence or two
 * (the summary is a retrieval hint, written for the docs service, not for the player).
 */
export function lead(doc: Doc, max = 240): string {
  const para = doc.body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^#/.test(p) && !/^\*\*|^[-*] /.test(p)) ?? doc.meta.summary ?? "";
  const text = para.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*/g) ?? [text];
  let out = "";
  for (const s of sentences) { if ((out + s).length > max) break; out += s; }
  return out.trim() || `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

const sceneTitle = (state: SessionState, id: string) => (id === state.sceneId ? "this scene" : safeScene(id)?.title ?? id);

/** The last thing someone said to the player, as shown (a tagged or worked-out line of the GM's). */
function lastWords(state: SessionState, id: string): { line: string; turn: number; scene: string } | undefined {
  for (const e of [...state.transcript].reverse()) {
    if (e.kind === "dialogue" && e.speaker === id) return { line: e.text, turn: e.turn, scene: e.scene ?? state.sceneId };
    const said = e.marked?.speech.filter(s => s.speaker === id).at(-1);
    if (said) return { line: e.text.slice(said.start, said.end), turn: e.turn, scene: e.scene ?? state.sceneId };
  }
  return undefined;
}

/** The card for a mark's link, or undefined when there's nothing to say that the player knows. */
export function knowledgeCard(state: SessionState, link: MarkLink): Card | undefined {
  if (link.kind === "deed") {
    const e = state.transcript.find(x => x.kind === "player" && x.turn === link.turn && (x.scene ?? state.sceneId) === link.scene);
    if (!e) return undefined;
    return { title: "What you did", lines: [`In ${sceneTitle(state, link.scene)}, turn ${link.turn}:`, `“${e.text.replace(/^["“]|["”]$/g, "")}”`] };
  }
  const scene = safeScene(state.sceneId);
  if (link.kind === "lore") {
    const doc = readDoc(state.id, link.path);
    if (!doc || doc.meta.visibility !== "public") return undefined;
    // A name the player hasn't heard, in the place's lore, as what they'd call its owner.
    const known = (words: string) => (scene ? asKnown(words, scene, state) : words);
    return { title: known(titleOf(doc)), lines: [known(lead(doc)), "What anyone in Caerwyn could tell you."] };
  }
  const c = scene?.cast.find(x => x.id === link.id);
  const known = scene && c ? knownCast(scene, state).has(c.id) : true;
  const entity = state.world?.entities[link.id];
  const name = c ? (known ? c.name : c.called ?? c.name) : entity?.name;
  if (!name) return undefined;
  const words = lastWords(state, link.id);
  const met = state.transcript.find(e => e.kind === "narration" && e.marked?.speech.some(s => s.speaker === link.id));
  const lore = c && known ? publicDocOf(state, c.name) : undefined;
  return {
    title: name.charAt(0).toUpperCase() + name.slice(1),
    lines: [
      ...(lore ? [lead(lore)] : []),
      ...(met ? [`You met them in ${sceneTitle(state, met.scene ?? state.sceneId)}.`] : []),
      ...(words ? [`Last said to you (turn ${words.turn}): ${words.line}`] : []),
    ],
  };
}

/** Someone's public lore (Cast/<Name>/public.md), what anyone could know of them. */
function publicDocOf(state: SessionState, name: string): Doc | undefined {
  const doc = readDoc(state.id, `Cast/${name}/public.md`);
  return doc?.meta.visibility === "public" ? doc : undefined;
}
