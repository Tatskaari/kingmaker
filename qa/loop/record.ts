import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Entry as ViewEntry, SceneView } from "../../client/scene/view.ts";

/**
 * A game of a round as the loop keeps it (games/<game>.json): what its player saw of the scene,
 * entry by entry, with who said each spoken line by the name the player knew them by then; how the
 * game got there (the character, the scenes ended on the way); what the story handed on to the scene
 * (the GM's side, for the reviewer); and how each turn went (how long it took, what it waited on).
 * start writes it, and every say brings it up to date from the game's rows.
 */

export interface GameRecord {
  round: string;
  game: string;
  /** The scene the game plays (its key), and the stack it's played on (the arm's folder). */
  scene: string;
  stack: string;
  /** The character: made from the persona's sentence, or the nearest ready-made build (and why). */
  player?: { name: string; concept: string; build?: string; made: string };
  /** The game's number on the stack, its uid (the AI service's folder for it, and its keys' first part), its campaign. */
  gameId?: string;
  uid?: string;
  campaign?: { id: string; version: string };
  /** The scene's row id: its calls' keys name it (`<uid>:s<row>:t<n>:<step>`). */
  sceneRow?: string;
  /** The scenes ended on the way to this one (a later scene's game), each on its first good or mixed ending. */
  skipped: Skipped[];
  /** What the player was told walking in (the line under the scene's title), and for a later scene their notebook of the story so far. */
  hook?: string;
  notebook?: string[];
  /** What the boundary handed on to the scene, as the GM had it (owner rows): the reviewer's. */
  handedOn?: HandedOn;
  /** The scene as the player saw it. */
  entries: Entry[];
  /** How each turn went, by its number. */
  turns: Record<string, TurnLog>;
  /** How the scene ended: its ending's title, and its id and grade where the scene says. */
  ended?: { turn: number; title: string; exit?: string; result?: string };
  /** The game is done with: the scene over, out of turns, or stopped (start failed, or the daily ceiling). */
  stopped?: string;
}

export interface Skipped { scene: string; exit: string; title?: string; result?: string }

export interface HandedOn { adjustments: string[]; opening?: string; lead?: string; owed: string[]; absent: string[] }

/** A transcript entry as the player saw it: the player's line, the GM's words, a dice line, the game's own line. */
export interface Entry {
  turn: number;
  kind: ViewEntry["kind"];
  /** Who said a dialogue entry, by the name the player knew them by. */
  who?: string;
  text: string;
  /** The spoken lines in a reply: [start, end) in its text, and who said each (as the player knew them; "Someone" when nobody can tell). */
  speech?: Array<{ start: number; end: number; who: string }>;
}

/** How a turn went: what was said, when, how long its answer took, and what the loop waited on before it came. */
export interface TurnLog {
  said?: string;
  at: string;
  ms?: number;
  /** Each wait and try again: the key's in-flight spending cap (HTTP 402), a turn that failed, no answer yet. */
  waits: Wait[];
  /** Model calls that OpenRouter turned away with a 402 (the in-flight cap) while the turn was answered: the module tried them again. */
  capped?: number;
  failed?: string;
}

export interface Wait { at: string; why: string; ms: number }

// ---------------------------------------------------------------------------------------------
// The file

export function readRecord(path: string): GameRecord | undefined {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as GameRecord : undefined;
}

/** Written whole beside its place and moved in, so a reader never finds half of it. */
export function writeRecord(path: string, record: GameRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 1)}\n`);
  renameSync(temp, path);
}

export const newRecord = (at: Pick<GameRecord, "round" | "game" | "scene" | "stack">): GameRecord => ({ ...at, skipped: [], entries: [], turns: {} });

// ---------------------------------------------------------------------------------------------
// From the client's view

/**
 * The scene's entries as the player saw them: each spoken line's speaker named as the screen's
 * colour tells them apart (the name they've heard, or what they'd call them), the player's own
 * words by their character's name, and no notes (the marks' notes aren't the GM's reply).
 */
export function entriesOf(view: SceneView): Entry[] {
  const name = (key: string | undefined, tag?: string) =>
    key === "you" ? view.player.name : (key ? view.present.find(p => p.key === key)?.name : undefined) ?? tag ?? "Someone";
  return view.entries.map(e => ({
    turn: e.turn, kind: e.kind, text: e.text,
    ...(e.kind === "dialogue" ? { who: e.name ?? name(e.speaker) } : {}),
    ...(e.markup?.speech.length ? { speech: e.markup.speech.map(s => ({ start: s.start, end: s.end, who: name(s.speaker, s.tag) })) } : {}),
  }));
}

/**
 * The entries kept up to date from the view: each one already kept stays as it was recorded (who
 * spoke is the name the player knew then), and the view's new ones are added.
 */
export function mergeEntries(kept: Entry[], seen: Entry[]): Entry[] {
  return seen.length > kept.length ? [...kept, ...seen.slice(kept.length)] : kept;
}

// ---------------------------------------------------------------------------------------------
// As text

/** The entries by turn, in order (turn 0 is the opening). */
export function turnsOf(entries: Entry[]): Array<[number, Entry[]]> {
  const turns = new Map<number, Entry[]>();
  for (const e of entries) turns.set(e.turn, [...(turns.get(e.turn) ?? []), e]);
  return [...turns].sort((a, b) => a[0] - b[0]);
}

/** The player's turns taken: their lines in the scene. */
export const turnsTaken = (record: Pick<GameRecord, "entries">) => record.entries.filter(e => e.kind === "player").length;

/**
 * An entry as the player read it: their own line quoted, a dice line, the game's line, dialogue by
 * name, and a reply with each spoken line after its speaker's name ("Kell: “Out.”"), as the screen
 * shows it in their colour.
 */
export function entryText(e: Entry): string {
  if (e.kind === "player") return `> ${e.text}`;
  if (e.kind === "roll") return `🎲 ${e.text}`;
  if (e.kind === "system") return `— ${e.text} —`;
  if (e.kind === "dialogue") return `${e.who ?? "Someone"}: ${e.text}`;
  return labelled(e.text, e.speech ?? []);
}

/** A turn as the player read it; `player: false` leaves their own line out (the reply alone, as a quote is checked against). */
export function turnText(entries: Entry[], options: { player?: boolean } = {}): string {
  return entries.filter(e => options.player !== false || e.kind !== "player").map(entryText).join("\n\n");
}

/** The reply's text with each spoken line after its speaker's name. */
function labelled(text: string, speech: NonNullable<Entry["speech"]>): string {
  let out = "", at = 0;
  for (const s of [...speech].sort((a, b) => a.start - b.start)) {
    if (s.start < at) continue;
    out += `${text.slice(at, s.start)}${s.who}: `;
    at = s.start;
  }
  return out + text.slice(at);
}
