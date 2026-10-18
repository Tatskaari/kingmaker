import { docsConfig } from "./config.ts";
import { characterEntry, parseDoc, writeDoc } from "./docs.ts";
import { dirname, join } from "./paths.ts";

/**
 * The GM's notes on a person: one living note per person per game (the user, after QA round
 * qa1-1018: "Maybe memory is more like GM notes for the character rather than personal memories").
 * It's in the third person and actionable, in five parts: how they stand with the player character
 * now and why, what they've seen the player do, what they've learned, the promises made by them or to
 * them, and what they did. It's kept current: an update rewrites a line or adds one, and each part
 * holds so many lines at most (SECTIONS), the oldest giving way, so the note never grows past a page.
 *
 * It lives in the game's own copy of the lore beside the person's entry (Cast/<Name>/notes.md, or
 * characters/<id>/notes.md for someone with no lore), the GM's alone, and is read only from there:
 * it's the game's, never the campaign's authored lore. The memory reviews update it after a turn
 * (reviews.ts), the boundary writes what an ending says of them and the time between (gm/boundary.ts),
 * and a talk what a companion told (gm/talk.ts); the two-part co-GM, a talk and the old pipeline's GM
 * read it (gmNotes).
 */

export type NoteSection = "standing" | "seen" | "learned" | "promises" | "did";

/** The note's parts, in order: each one's heading in the doc, how many lines it holds at most, and what goes in it (the reviews are told). */
export const SECTIONS: ReadonlyArray<{ key: NoteSection; heading: string; most: number; about: string }> = [
  { key: "standing", heading: "Standing with the player", most: 1, about: "how they stand with the player character now, and why, in one line (it's rewritten, never added to)" },
  { key: "seen", heading: "Seen the player do", most: 5, about: "what they've seen the player character do that they'd bring up later: a kindness or a cruelty, a threat, a gift, payment or trade, a lie found out, how they treated someone" },
  { key: "learned", heading: "Learned", most: 6, about: "what they've learned, or seen and heard for themselves, that the story may need from them: an admission, a secret, a name, who came or went and when, something handed over or found" },
  { key: "promises", heading: "Promises", most: 4, about: "promises made by them or to them: who promised what to whom, on what terms, and whether it's been kept" },
  { key: "did", heading: "Did", most: 8, about: "what they did of consequence: told something, lied, gave something up, took a side, left; how each scene ended for them, and the time between" },
];

export const NOTE_SECTIONS = SECTIONS.map(s => s.key);

/** A person's notes, part by part: each part's lines, oldest first. */
export type Notes = Record<NoteSection, string[]>;

/** Whom a note is about: their cast id, and their name for its title. */
export interface NotePerson { id: string; name: string }

/** A line at most this long (longer is cut at a word, with an ellipsis). */
export const LONGEST_LINE = 300;

/** Where someone's notes are in a game's copy of the lore: beside their lore entry, or under characters/ for someone with none. */
export function notesPath(id: string): string {
  const entry = characterEntry(id);
  return entry ? join(dirname(entry), "notes.md") : `characters/${id}/notes.md`;
}

/** Whether a doc's path is someone's notes (the world-facts agent leaves them to the notes review). */
export const isNotesPath = (path: string): boolean => /^(?:Cast|characters)\/.+\/notes\.md$/.test(path);

const none = (): Notes => ({ standing: [], seen: [], learned: [], promises: [], did: [] });

/** Someone's notes in a game, from its own copy only (an authored doc at the same path is never theirs). */
export function readNotes(game: string, id: string): Notes {
  const path = notesPath(id);
  const text = docsConfig().overlay(game).read(path);
  const notes = none();
  if (text === undefined) return notes;
  let at: NoteSection | undefined;
  for (const raw of parseDoc(path, text).body.split("\n")) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(raw)?.[1];
    if (heading !== undefined) { at = SECTIONS.find(s => s.heading.toLowerCase() === heading.toLowerCase())?.key; continue; }
    const line = /^\s*[-*]\s+(.+?)\s*$/.exec(raw)?.[1];
    if (at && line) notes[at].push(line);
  }
  return notes;
}

const isEmpty = (notes: Notes) => SECTIONS.every(s => !notes[s.key].length);

/**
 * Someone's notes as a model reads them, part by part ("Standing with the player: …", then each
 * other part's lines), or undefined when there are none. `keys`: each part named by its key too, for
 * the notes review, which answers by them.
 */
export function notesText(notes: Notes, options: { keys?: boolean } = {}): string | undefined {
  if (isEmpty(notes)) return undefined;
  const label = (s: (typeof SECTIONS)[number]) => (options.keys ? `${s.key} (${s.heading})` : s.heading);
  return SECTIONS.filter(s => notes[s.key].length).map(s => s.most === 1
    ? `${label(s)}: ${notes[s.key][0]}`
    : `${label(s)}:\n${notes[s.key].map(l => `- ${l}`).join("\n")}`).join("\n");
}

/**
 * A person's GM notes for a game, as any GM part reads them (notesText), or undefined when play
 * hasn't given them any: what the two-part co-GM, a talk and the old pipeline's GM are given.
 */
export function gmNotes(game: string, id: string): string | undefined {
  return notesText(readNotes(game, id));
}

/** A line as it's kept: one line, no bullet, at most LONGEST_LINE long. */
export function lineOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/^\s*[-*]\s+/, "").trim();
  if (flat.length <= LONGEST_LINE) return flat;
  return `${flat.slice(0, LONGEST_LINE - 1).replace(/\s+\S*$/, "")}…`;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What a note's update did: added a line, rewrote one, took one out, set the standing, or nothing (it was there already); and the oldest line a full part gave up for it. */
export interface Noted { did: "added" | "rewrote" | "removed" | "set" | "kept"; line: string; was?: string; dropped?: string }

/**
 * A line in someone's notes, written to the game's copy at once (read again first, so two writers
 * one after the other keep each other's lines). The standing is set: its one line is replaced. With
 * `replaces` (a line of that part, as the notes have it: the same words, or enough of them to find
 * just one), that line is rewritten, or taken out when `line` is empty; one that isn't there is
 * added instead. A line the part has already is kept as it is. A part that's full gives up its oldest
 * line for a new one.
 */
export function note(game: string, person: NotePerson, section: NoteSection, line: string, options: { replaces?: string; origin?: { scene: string; turn: number } } = {}): Noted {
  const part = SECTIONS.find(s => s.key === section);
  if (!part) throw new Error(`No part of the notes called ${section}: ${NOTE_SECTIONS.join(", ")}`);
  const notes = readNotes(game, person.id);
  const lines = notes[section];
  const text = lineOf(line);
  const done = (noted: Noted): Noted => {
    if (noted.did !== "kept") write(game, person, notes, options.origin);
    return noted;
  };
  if (section === "standing") {
    if (!text) return { did: "kept", line: text };
    if (lines.length === 1 && same(lines[0]!, text)) return { did: "kept", line: text };
    notes.standing = [text];
    return done({ did: "set", line: text, ...(lines[0] ? { was: lines[0] } : {}) });
  }
  const old = options.replaces?.trim() ? findLine(lines, lineOf(options.replaces)) : undefined;
  if (old !== undefined) {
    const was = lines[old]!;
    if (!text || lines.some((l, i) => i !== old && same(l, text))) {
      lines.splice(old, 1);
      return done({ did: "removed", line: text, was });
    }
    if (same(was, text)) return { did: "kept", line: text };
    lines[old] = text;
    return done({ did: "rewrote", line: text, was });
  }
  if (!text || lines.some(l => same(l, text))) return { did: "kept", line: text };
  const dropped = lines.length >= part.most ? lines.splice(0, lines.length - part.most + 1) : [];
  lines.push(text);
  return done({ did: "added", line: text, ...(dropped.length ? { dropped: dropped.join(" / ") } : {}) });
}

/** The line a `replaces` names: the same words, or else the one line that has them in it (a dozen letters or more, so it's that line and no other). */
function findLine(lines: string[], wanted: string): number | undefined {
  const exact = lines.findIndex(l => same(l, wanted));
  if (exact >= 0) return exact;
  const words = wanted.replace(/…$/, "").toLowerCase();
  if (words.length < 12) return undefined;
  const holding = lines.flatMap((l, i) => (l.toLowerCase().includes(words) || (l.length >= 12 && words.includes(l.toLowerCase())) ? [i] : []));
  return holding.length === 1 ? holding[0] : undefined;
}

/** The note written whole into the game's copy: its title, then each part that has lines; the scene and turn it was last brought up to date on, when a write says (else as it was). */
function write(game: string, person: NotePerson, notes: Notes, origin?: { scene: string; turn: number }): void {
  const path = notesPath(person.id);
  const text = docsConfig().overlay(game).read(path);
  const was = text === undefined ? undefined : parseDoc(path, text).meta;
  const last = origin ?? (was?.scene !== undefined && was.turn !== undefined ? { scene: was.scene, turn: was.turn } : undefined);
  const body = [`# ${person.name}: notes from play`, ...SECTIONS.filter(s => notes[s.key].length).map(s => `## ${s.heading}\n${notes[s.key].map(l => `- ${l}`).join("\n")}`)].join("\n\n");
  writeDoc(game, {
    path,
    meta: {
      summary: `The GM's notes on ${person.name} in this game, kept current: how they stand with the player and why, what they've seen the player do, what they've learned, promises made by them or to them, and what they did.`,
      type: "notes", visibility: "gm", ...(last ? { scene: last.scene, turn: last.turn } : {}),
    },
    body,
  });
}
