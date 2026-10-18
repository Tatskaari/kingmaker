import { presentCast } from "../../shared/scene/graph.ts";
import { heardIn, knownCast, namedIn } from "../../shared/scene/names.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { Entity } from "../../shared/world/scene-world.ts";
import type { TurnView } from "./view.ts";

/**
 * Names the player hasn't heard, kept out of the narration (QA round qa1-1018: Moll, Hep, Dilly
 * and the dog Duchess were named by the narration before anyone said their names, and from then on
 * the player used them). The mouthpiece is told what to call them (two-part.ts twoPartNow), and
 * what it writes is put right before it's shown or kept: `asKnown` swaps a name the player hasn't
 * heard for what they'd call that person ("Moll snorts." is "The girl in the shawl snorts."), in
 * the narration's own words only. A speaker's tag ([Moll]) is for the screen and stays as written,
 * and a name inside a line said aloud (or words quoted as written) stays too: someone saying it is
 * how the player hears it, and from there on the reply may use it.
 */

/** Someone the player hasn't heard named, and what the narration calls them instead. */
export interface Unheard {
  id: string;
  /** Their name as the prep has it ("Big Hobb Mallory", "Duchess"). */
  name: string;
  /** What else they go by ("Hep"). */
  aka?: string[];
  /** What the player would call them: "the girl in the shawl". */
  called: string;
  /** What a second mention, or one that owns something, calls them: "the girl" (the girl's fist). */
  short: string;
  /** In the place now (the per-turn note lists those). */
  here: boolean;
}

/** Titles a name can come with ("Master Sallow", "big Hobb", "Mr. Scrope"): taken with it, since what they're called says who they are. */
const HONORIFIC = "[Bb]ig|[Oo]ld|[Yy]oung|[Ll]ittle|[Mm]aster|[Mm]ister|[Mm]istress|[Mm]issus|[Mm]rs?\\.?|[Mm]iss|[Mm]adam|[Ss]ergeant|[Cc]orporal|[Cc]aptain|[Mm]arshal|[Kk]ing|[Qq]ueen|[Ss]ir|[Ll]ady|[Ll]ord|[Dd]ame";
const TITLE_WORD = new RegExp(`^(?:${HONORIFIC})$`);

/** What they're called up to the words that only tell them apart ("the girl in the shawl" is "the girl"), for a second mention. */
export const shortOf = (called: string): string => called.replace(/\s+(?:with|in|by|from|at|on|of|who|behind|beside|under|near)\s.*$/, "");

/** The last word of what someone's called ("girl", "pot-boy"): two people who share it can't go by their short forms. */
const headOf = (called: string): string => shortOf(called).split(/\s+/).at(-1)!.toLowerCase();

/**
 * What to call a creature or a person of the place who isn't on a card and goes by a name (the
 * Heron's mastiff, Duchess): what it is, from its description ("A vast, elderly brindle mastiff…"
 * is "the mastiff"), else what kind of thing it is.
 */
const KINDS = "mastiff|hound|dog|cur|terrier|lurcher|cat|horse|mare|pony|mule|donkey|goat|pig|sow|boar|ox|cow|bull|rat|raven|crow|magpie|parrot|cockerel|goose|hen|bear|wolf|fox|man|woman|boy|girl|child|lad|lass|gentleman|lady|porter|clerk|watchman|sailor|bargee|soldier";
function calledFor(e: Entity): string {
  const first = (e.description ?? "").split(/(?<=[.;:])\s/)[0]!.toLowerCase();
  const kind = new RegExp(`\\b(${KINDS})\\b`).exec(first)?.[1];
  return `the ${kind ?? (e.kind === "creature" ? "animal" : "stranger")}`;
}

/** A name the place gives someone off the cards, as a name ("Duchess"), not a description ("the re-sacking gang"). */
const properName = (name: string) => /^[A-Z]/.test(name) && !/^(?:The|A|An|Some|Two|Three)\s/.test(name);

/**
 * Everyone whose name the player hasn't heard (in anything said or shown so far, their own turns
 * too), with what to call them: the scene's cast with a `called` (here or not: a name the narration
 * drops for someone away is theirs to hear first too), and whoever of the place's people goes by a
 * name and has no card (a dog called Duchess), what they are.
 */
export function unheardOf(scene: Scene, view: TurnView): Unheard[] {
  const known = knownCast(scene, view);
  const here = new Set(presentCast(scene, view).map(c => c.id));
  const cast = scene.cast.filter(c => c.called && !known.has(c.id)).map(c => ({ id: c.id, name: c.name, ...(c.aka?.length ? { aka: c.aka } : {}), called: c.called!, here: here.has(c.id) }));
  const heard = heardIn(view, [scene.hook]);
  const others = Object.values(view.world?.entities ?? {})
    .filter(e => (e.kind === "creature" || e.kind === "person") && !e.player && !e.cast && !scene.cast.some(c => c.id === e.id) && !e.states.includes("gone") && properName(e.name) && !namedIn({ name: e.name }, heard))
    .map(e => ({ id: e.id, name: e.name, called: calledFor(e), here: true }));
  const all = [...cast, ...others];
  // A short form two of them would share ("the man", "the clerk") isn't theirs: they keep their whole one.
  const heads = new Map<string, number>();
  for (const u of all) heads.set(headOf(u.called), (heads.get(headOf(u.called)) ?? 0) + 1);
  return all.map(u => ({ ...u, short: heads.get(headOf(u.called))! > 1 ? u.called : shortOf(u.called) }));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The runs of someone's name that mean them in text, longest first ("Hobb Mallory", "Hobb", "Mallory"; "Hep"): its words but its titles, three letters or more alone. */
function runsOf(u: Pick<Unheard, "name" | "aka">): string[] {
  const words = u.name.split(/\s+/).filter(w => !TITLE_WORD.test(w)).map(w => w.replace(/[^\p{L}'’-]/gu, "")).filter(Boolean);
  const runs: string[] = [];
  for (let n = words.length; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) {
    const run = words.slice(i, i + n);
    if (n > 1 || run[0]!.length >= 3) runs.push(run.join(" "));
  }
  return [...new Set([...runs, ...(u.aka ?? []).filter(a => a.length >= 3)])];
}

/** Whole words of a name as written: capitalised, as names are ("Will" is a name, "will" isn't). */
const wordsOf = (runs: string[]) => runs.map(r => r.split(" ").map(escape).join("\\s+")).join("|");

/** A piece of the reply: narration, or what the pass leaves as written (a line said or words quoted, a tag or a note in square brackets). */
interface Piece { text: string; kind: "narration" | "quoted" | "bracket" }

/** Is a quote mark at `i` opening a quotation (after the start, a space, a bracket or a dash), rather than closing one or an apostrophe? */
const opensAt = (raw: string, i: number) => i === 0 || /[\s([\]{—–-]/.test(raw[i - 1]!);

/**
 * The reply cut into pieces: square brackets (a speaker's tag, a note) on their line; a line said
 * (“…”, "…") to its closing quote or the paragraph's end; words quoted in single quotes (‘…’, '…')
 * to a closing one that isn't an apostrophe (not between letters), within the paragraph; the rest
 * narration. `partial`: the reply so far, so a bracket not yet closed is held back (it may be a tag).
 */
function piecesOf(raw: string, partial: boolean): { pieces: Piece[]; held: number } {
  const pieces: Piece[] = [];
  let narration = "";
  const flush = () => { if (narration) pieces.push({ text: narration, kind: "narration" }); narration = ""; };
  const paragraphEnd = (from: number) => { const p = raw.indexOf("\n\n", from); return p < 0 ? raw.length : p; };
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === "[") {
      const nl = raw.indexOf("\n", i);
      const close = raw.indexOf("]", i);
      if (close >= 0 && (nl < 0 || close < nl)) { flush(); pieces.push({ text: raw.slice(i, close + 1), kind: "bracket" }); i = close + 1; continue; }
      // Not closed on its line yet: it may be a tag still being written.
      if (partial && nl < 0) { flush(); return { pieces, held: i }; }
    } else if (c === "“" || (c === "\"" && opensAt(raw, i))) {
      const end = paragraphEnd(i);
      const closer = c === "“" ? /[”"]/g : /"/g;
      closer.lastIndex = i + 1;
      const m = closer.exec(raw);
      const stop = m && m.index < end ? m.index + 1 : end;
      flush(); pieces.push({ text: raw.slice(i, stop), kind: "quoted" }); i = stop; continue;
    } else if ((c === "‘" || c === "'") && opensAt(raw, i) && (/\p{L}/u.test(raw[i + 1] ?? "") || (partial && i + 1 >= raw.length))) {
      // The last thing written so far: it may open quoted words, so it waits.
      if (i + 1 >= raw.length) { flush(); return { pieces, held: i }; }
      const end = paragraphEnd(i);
      let k = i + 1;
      for (; k < end; k++) if ((raw[k] === "’" || raw[k] === "'") && !/\p{L}/u.test(raw[k + 1] ?? "") && !(partial && k + 1 >= raw.length)) break;
      if (k < end) { flush(); pieces.push({ text: raw.slice(i, k + 1), kind: "quoted" }); i = k + 1; continue; }
      // Still open as the reply streams: what follows may be quoted words, so it waits.
      if (partial && end >= raw.length) { flush(); return { pieces, held: i }; }
    }
    narration += c;
    i++;
  }
  flush();
  return { pieces, held: raw.length };
}

/** Is a match at the end of `before` (the reply up to it) at the start of a sentence? */
const sentenceStart = (before: string) => { const b = before.replace(/[ \t]+$/, ""); return !b || b.endsWith("\n") || /[.!?…][”"’')\]]*$/.test(b); };

/**
 * The reply with each name the player hasn't heard swapped, in its narration, for what they'd call
 * that person: the first time in full ("the girl in the shawl"), then, or where it owns something,
 * the short way ("the girl", "the girl's fist"); a capital at a sentence's start; a title taken with
 * the name ("Master Sallow" is "the gentleman with the silver-topped cane"). Lines said and words
 * quoted keep their names, and a name in one is heard from there on (`heard`: their ids); a tag
 * keeps its name too, but nobody hears a tag. `partial`: the reply so far, as it streams: whatever
 * might yet be a name, or a title before one, waits for the next words, so what's shown only grows.
 */
export function asKnown(raw: string, unheard: Unheard[], options: { partial?: boolean } = {}): { text: string; heard: string[] } {
  const partial = !!options.partial;
  if (!unheard.length) return { text: raw, heard: [] };
  // As it streams: the last word (it may grow into a name, or own something), any titles just before it, and a quote mark that may open a quotation, wait.
  const tail = partial ? new RegExp(`(?:(?:${HONORIFIC}|[A-Z]\\.)\\s+)*[\\p{L}'’‘.-]*$`, "u").exec(raw)!.index : raw.length;
  const { pieces, held } = piecesOf(raw.slice(0, tail), partial);
  const people = unheard.map(u => ({ u, runs: runsOf(u) })).filter(p => p.runs.length);
  if (!people.length) return { text: raw.slice(0, Math.min(tail, held)), heard: [] };
  const named = new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:(?:${HONORIFIC}|[A-Z]\\.)\\s+)*(${people.map(p => wordsOf(p.runs)).join("|")})((?:['’]s|(?<=s)['’](?!\\p{L}))?)(?![\\p{L}\\p{N}-])`, "gu");
  const heard = new Set<string>();
  const mentioned = new Set<string>();
  const whose = (word: string) => people.find(p => p.runs.some(r => new RegExp(`^${r.split(" ").map(escape).join("\\s+")}$`).test(word)))?.u;
  let out = "";
  for (const piece of pieces) {
    if (piece.kind !== "narration") {
      // Said aloud, or written and read: heard from here on (a tag is for the screen, never heard).
      if (piece.kind === "quoted") for (const p of people) if (new RegExp(`(?<![\\p{L}])(?:${wordsOf(p.runs)})(?![\\p{L}])`, "u").test(piece.text)) heard.add(p.u.id);
      out += piece.text;
      continue;
    }
    let last = 0;
    for (const m of piece.text.matchAll(named)) {
      const u = whose(m[1]!);
      if (!u || heard.has(u.id)) continue;
      const before = out + piece.text.slice(last, m.index);
      // What they own is theirs by the short way, with its apostrophe as written ("Duchess’ bowl" is "the mastiff’s bowl").
      const owns = m[2] ? `${m[2][0]}s` : "";
      let name = owns || mentioned.has(u.id) ? u.short : u.called;
      mentioned.add(u.id);
      // "the Master Sallow" isn't "the the gentleman…".
      if (/\bthe\s+$/i.test(before) && /^the\s/i.test(name)) name = name.replace(/^the\s+/i, "");
      if (sentenceStart(before)) name = name[0]!.toUpperCase() + name.slice(1);
      out = before + name + owns;
      last = m.index + m[0].length;
    }
    out += piece.text.slice(last);
  }
  return { text: out, heard: [...heard] };
}
