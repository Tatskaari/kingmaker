import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Card, Mark, MarkLink, Markup, Speech } from "../../shared/markup.ts";
import { idempotencyKey, keyParts } from "../../shared/protocol/keys.ts";
import type { SceneFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { readCampaignFiles } from "../dev/campaign.ts";
import { sql } from "../dev/spacetime.ts";
import type { StackFile } from "../dev/stack-file.ts";
import type { Offered, Played, Run } from "./play.ts";
import type { Script } from "./scripts.ts";

/**
 * A live run's record (v5-design §4.6): each turn's moments, who said what, the notes and the lines
 * offered, and the model calls and their cost; from the game's rows (read as the owner), the AI
 * service's call log and kept answers, and the campaign's scene, for the names and for what's held
 * from the player.
 */

/** A model call, done: its key's turn, and what it cost. */
export interface Call { key: string; turn?: number; operation: string; model: string; costUsd: number; latencyMs: number }
/** A spoken line: who says it as the cast card names them, the GM's tag when it wrote one, and the line. */
export interface Spoken { who: string; tag?: string; text: string }
/** A note: its kind, the phrase it's on, the note, what it links to and the card the popover shows. */
export interface Noted { kind: string; phrase: string; note: string; link?: string; card?: Card }
export interface EntryRecord { kind: string; speaker: string; text: string; spoken: Spoken[]; notes: Noted[] }

export interface TurnRecord {
  n: number;
  /** The script's step, and the line said (for an act, the line it picked). */
  step?: string;
  said?: string;
  /** Server times in microseconds: the turn's start, its first words, its reply's entry, its end. */
  saidAt: number;
  firstAt?: number;
  finalAt?: number;
  doneAt?: number;
  /** Milliseconds after the reply's entry reached this client: its notes' commit, its lines'. */
  notesMs?: number;
  linesMs?: number;
  /** How its notes and lines stood at the end: the turn's columns. */
  notes: string;
  suggest: string;
  calls: Call[];
  entries: EntryRecord[];
  /** The lines offered after it, and what the AI service screened out of them, and why. */
  lines: Offered[];
  dropped: Array<{ text: string; why: string }>;
}

/** What the scene keeps from the player: its people's secrets, and what it needs them to come across that they haven't. */
export interface Held { secrets: Array<{ who: string; text: string }>; essentials: Array<{ what: string; with: string[] }> }

export interface LiveRecord {
  script: Script;
  date: string;
  rehearse: boolean;
  /** The steps asked for (--lines). */
  lines: number;
  mode: string;
  model: string;
  game: string;
  who: string;
  build: string;
  turns: TurnRecord[];
  /** Steps that said nothing: an act with no line to pick. */
  skipped: Played[];
  stopped?: string;
  /** The scene's ending, when it ended. */
  ending?: string;
  calls: Call[];
  cost: number;
  held: Held;
}

export interface RecordSetup { script: Script; date: string; rehearse: boolean; lines: number; model: string }

type Row = Record<string, unknown>;

const CAMPAIGN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");

export async function recordOf(stack: StackFile, run: Run, setup: RecordSetup): Promise<LiveRecord> {
  const game = run.game!;
  const rows = await rowsOf(stack, game.id, game.sceneId);
  const scene = installedScene(String(rows.scene.scene_key));
  const calls = callsOf(stack.root, game.uid);
  const said = new Map(run.played.filter(p => p.n !== undefined).map(p => [p.n!, p]));

  return {
    ...setup, mode: stack.mode, game: game.uid,
    who: `${rows.player.name}: ${rows.player.concept}`, build: String(rows.sheet.build),
    turns: rows.turns.map(t => turnRecord(t, {
      entries: rows.entries, scene, run, calls, step: said.get(Number(t.n)),
      dropped: droppedOf(stack.root, idempotencyKey(game.uid, game.sceneId, Number(t.n), "suggest", Math.max(1, Number(t.suggest_asks)))),
    })),
    skipped: run.played.filter(p => p.skipped),
    ...(run.stopped ? { stopped: run.stopped } : {}),
    ...(rows.scene.exit_key ? { ending: String(rows.scene.exit_key) } : {}),
    calls,
    cost: calls.reduce((sum, c) => sum + c.costUsd, 0),
    held: heldFrom(scene, (rows.gm?.landed as string[] | undefined) ?? []),
  };
}

/** The game's spend so far, and its dearest turn, in dollars: from the call log, so the notes' and lines' calls count as they're made. */
export function spentOf(root: string, uid: string): { total: number; dearest: number } {
  const byTurn = new Map<number, number>();
  for (const c of callsOf(root, uid)) byTurn.set(c.turn ?? -1, (byTurn.get(c.turn ?? -1) ?? 0) + c.costUsd);
  return { total: [...byTurn.values()].reduce((a, b) => a + b, 0), dearest: Math.max(0, ...byTurn.values()) };
}

/** The scene's suggested lines now, as its rows have them. */
export async function offeredOf(stack: StackFile, sceneId: bigint): Promise<Offered[]> {
  const rows = await sql(stack.http, `SELECT * FROM scene_suggestion WHERE scene_id = ${sceneId}`, stack.owner.token);
  return rows.map(r => ({ turn: Number(r.turn), ord: Number(r.ord), kind: String(r.kind), text: String(r.text) }));
}

// ---------------------------------------------------------------------------------------------
// The rows.

interface Rows { scene: Row; player: Row; sheet: Row; gm?: Row; turns: Row[]; entries: Row[] }

/** The game's rows as the owner reads them (times in microseconds, options as values or null): the player and sheet are the scene's controller's. */
async function rowsOf(stack: StackFile, gameId: bigint, sceneId: bigint): Promise<Rows> {
  const query = (q: string) => sql(stack.http, q, stack.owner.token);
  const [[scene], players, sheets, [gm], turns, entries] = await Promise.all([
    query(`SELECT * FROM scene WHERE id = ${sceneId}`), query(`SELECT * FROM player WHERE game_id = ${gameId}`),
    query(`SELECT * FROM sheet WHERE game_id = ${gameId}`), query(`SELECT * FROM gm_state WHERE scene_id = ${sceneId}`),
    query(`SELECT * FROM turn WHERE scene_id = ${sceneId}`), query(`SELECT * FROM transcript WHERE scene_id = ${sceneId}`),
  ]);
  const lead = String(scene!.controller_id);
  return {
    scene: scene!, player: players.find(p => String(p.id) === lead)!, sheet: sheets.find(s => String(s.player_id) === lead)!, ...(gm ? { gm } : {}),
    turns: turns.sort((a, b) => Number(a.n) - Number(b.n)), entries: entries.sort((a, b) => Number(a.seq) - Number(b.seq)),
  };
}

interface TurnSources { entries: Row[]; scene: Scene; run: Run; calls: Call[]; step?: Played; dropped: Array<{ text: string; why: string }> }

function turnRecord(t: Row, from: TurnSources): TurnRecord {
  const n = Number(t.n);
  const entries = from.entries.filter(e => Number(e.turn) === n);
  const reply = entries.find(e => e.speaker === "gm");
  const seen = from.run.seen.get(n) ?? {};
  const after = (at: number | undefined) => (at !== undefined && seen.final !== undefined ? at - seen.final : undefined);
  return {
    n, ...(from.step ? { step: from.step.step, ...(from.step.said ? { said: from.step.said } : {}) } : {}),
    saidAt: Number(t.started_at),
    ...(t.first_text_at !== null ? { firstAt: Number(t.first_text_at) } : {}),
    ...(reply ? { finalAt: Number(reply.at) } : {}),
    ...(t.ended_at !== null ? { doneAt: Number(t.ended_at) } : {}),
    ...defined({ notesMs: after(seen.notes), linesMs: after(seen.lines) }),
    notes: String(t.notes), suggest: String(t.suggest),
    calls: from.calls.filter(c => c.turn === n),
    entries: entries.map(e => entryRecord(e, from.scene)),
    lines: from.run.sets.get(n) ?? [],
    dropped: from.dropped,
  };
}

/** An entry with its markup read: who says each line, and each note. */
function entryRecord(e: Row, scene: Scene): EntryRecord {
  const text = String(e.text);
  const markup = (e.markup ? JSON.parse(String(e.markup)) : { speech: [], marks: [] }) as Markup;
  return {
    kind: String(e.kind), speaker: String(e.speaker), text,
    spoken: markup.speech.map(s => spokenOf(s, text, scene)),
    notes: markup.marks.map(m => notedOf(m, text, scene)),
  };
}

function spokenOf(s: Speech, text: string, scene: Scene): Spoken {
  return { who: s.speaker ? nameOf(s.speaker, scene) : "nobody can tell", ...(s.tag ? { tag: s.tag } : {}), text: text.slice(s.start, s.end) };
}

function notedOf(m: Mark, text: string, scene: Scene): Noted {
  return { kind: m.kind, phrase: text.slice(m.start, m.end), note: m.note, ...(m.link ? { link: linkText(m.link, scene) } : {}), ...(m.card ? { card: m.card } : {}) };
}

/** Someone by the cast card's name ("kell" is Sergeant Agnes Kell; "you" the player); anyone else by their key. */
const nameOf = (key: string, scene: Scene) => (key === "you" ? "you" : scene.cast.find(c => c.id === key)?.name ?? key);

function linkText(link: MarkLink, scene: Scene): string {
  if (link.kind === "person") return nameOf(link.id, scene);
  if (link.kind === "lore") return link.path;
  return `your turn ${link.turn}${link.scene === scene.id ? "" : ` in ${link.scene}`}`;
}

/** The scene's people's secrets, and the essentials the player hasn't come across (gm_state.landed has those they have). */
function heldFrom(scene: Scene, landed: string[]): Held {
  return {
    secrets: scene.cast.flatMap(c => (c.secrets ?? []).map(text => ({ who: c.name, text }))),
    essentials: (scene.essentials ?? []).filter(e => !landed.includes(e.id)).map(e => ({ what: e.what, with: e.placedWith })),
  };
}

/** The campaign's scene, loaded with its words: what the record names people by and reads secrets from. */
function installedScene(key: string): Scene {
  const files = readCampaignFiles(CAMPAIGN);
  return sceneOf(JSON.parse(files[`scenes/${key}/scene.json`]!) as SceneFile, path => files[`scenes/${key}/${path}`]);
}

// ---------------------------------------------------------------------------------------------
// The AI service's store (the stack's ai/ folder).

/** The game's model calls, done: its call log's entries with a cost, each with its key's turn. */
export function callsOf(root: string, uid: string): Call[] {
  const path = join(root, "ai", "games", uid, "calls.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, any>)
    .filter(c => c.request && typeof c.costUsd === "number")
    .map(c => ({
      key: String(c.key), ...defined({ turn: keyParts(String(c.key))?.turn }), operation: String(c.operation),
      model: String(c.model ?? c.request.model ?? "?"), costUsd: c.costUsd, latencyMs: Number(c.latencyMs ?? 0),
    }));
}

/** What the suggested lines' answer screened out, and why: the kept answer by its key, [] when there's none. */
export function droppedOf(root: string, key: string): Array<{ text: string; why: string }> {
  const path = join(root, "ai", "answers", `${encodeURIComponent(key)}.json`);
  if (!existsSync(path)) return [];
  try {
    const body = JSON.parse(String((JSON.parse(readFileSync(path, "utf8")) as { body: string }).body)) as { dropped?: Array<{ text: string; why: string }> };
    return body.dropped ?? [];
  } catch {
    return [];
  }
}

/** An object without its undefined values. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
