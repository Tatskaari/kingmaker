import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Markup, Speech } from "../../shared/markup.ts";
import { idempotencyKey, turnKeyParts } from "../../shared/protocol/keys.ts";
import { loadScene } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { readCampaignFiles, scenePath } from "../dev/campaign.ts";
import { backgroundOf, statusOf, statusRows } from "../dev/gm-status.ts";
import { sql } from "../dev/spacetime.ts";
import type { StackFile } from "../dev/stack-file.ts";
import type { Offered, Played, Run, WalkedIn, WorldThing } from "./play.ts";
import type { Script } from "./scripts.ts";

/**
 * A live run's record (v5-design §4.6): each turn's moments, who said what, the lines offered (the
 * notes on marked words went in M2), and the model calls and their cost; from the game's rows (read as the owner), the AI
 * service's call log and kept answers, and the campaign's scene, for the names and for what's held
 * from the player.
 */

/** A model call, done: its key's turn, and what it cost. */
export interface Call { key: string; turn?: number; operation: string; model: string; costUsd: number; latencyMs: number }
/** A spoken line: who says it as the cast card names them, the GM's tag when it wrote one, and the line. */
export interface Spoken { who: string; tag?: string; text: string }
export interface EntryRecord { kind: string; speaker: string; text: string; spoken: Spoken[] }

export interface TurnRecord {
  n: number;
  /** The script's step, and the line said (for an act, the line it picked). */
  step?: string;
  said?: string;
  /** How long the line waited for the background jobs (the memory review) before it was said. */
  waited?: number;
  /** Server times in microseconds: the turn's start, its first words, its reply's entry, its end. */
  saidAt: number;
  firstAt?: number;
  finalAt?: number;
  doneAt?: number;
  /** Milliseconds after the reply's entry reached this client: its lines' commit. */
  linesMs?: number;
  /** How its lines stood at the end: the turn's column. */
  suggest: string;
  calls: Call[];
  entries: EntryRecord[];
  /** The lines offered after it, and what the AI service screened out of them, and why. */
  lines: Offered[];
  dropped: Array<{ text: string; why: string }>;
  /** The world's side (a script that records it): what the place's rows showed changed once the turn was done, the rules' act on the path, and who reacted to it and how. */
  world?: string[];
  act?: string;
  reactions?: string;
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
  /** The way into the scene, when the game began on the map (map-design §4). */
  walkedIn?: WalkedIn;
  calls: Call[];
  cost: number;
  held: Held;
  /** The GM's side once the run was over, as npm run status prints it (a script that records it: full-gm-design §4.4). */
  gm?: Record<string, unknown>;
  /** How long the run waited after its last line for the background jobs. */
  settledMs?: number;
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
  const gm = setup.script.gmSide || setup.script.worldSide ? await gmSideOf(stack, game, rows.scene) : undefined;
  const path = (gm?.path as string[] | undefined) ?? [];

  return {
    ...setup, mode: stack.mode, game: game.uid,
    who: `${rows.player.name}: ${rows.player.concept}`, build: String(rows.sheet.build),
    turns: rows.turns.map(t => ({
      ...turnRecord(t, {
        entries: rows.entries, scene, run, calls, step: said.get(Number(t.n)),
        dropped: droppedOf(stack.root, idempotencyKey(game.uid, game.sceneId, Number(t.n), "suggest", Math.max(1, Number(t.suggest_asks)))),
      }),
      ...(setup.script.worldSide ? worldSideOf(Number(t.n), run.worlds, path) : {}),
    })),
    skipped: run.played.filter(p => p.skipped),
    ...(run.stopped ? { stopped: run.stopped } : {}),
    ...(rows.scene.exit_key ? { ending: String(rows.scene.exit_key) } : {}),
    ...(run.walkedIn ? { walkedIn: run.walkedIn } : {}),
    ...(setup.script.gmSide && gm ? { gm, ...(run.settledMs !== undefined ? { settledMs: run.settledMs } : {}) } : {}),
    calls,
    cost: calls.reduce((sum, c) => sum + c.costUsd, 0),
    held: heldFrom(scene, (rows.gm?.landed as string[] | undefined) ?? []),
  };
}

/**
 * A turn's world side: what changed in the place from the turn before, as this client's rows had it
 * once each was done ("the hoist rope: destroyed", "Cob: gone"), the rules' act the path has for the
 * turn ("rules:cast:magic-missile"), and the reactions to it ("kell=intervene, cob=flee").
 */
export function worldSideOf(n: number, worlds: Map<number, WorldThing[]>, path: string[]): Pick<TurnRecord, "world" | "act" | "reactions"> {
  const now = worlds.get(n), before = new Map((worlds.get(n - 1) ?? []).map(e => [e.id, e]));
  const world = n === 0 || !now ? [] : now.flatMap(e => {
    if (!before.has(e.id)) return [`${e.name}: appeared${e.states.length ? ` (${e.states.join(", ")})` : ""}`];
    const was = before.get(e.id)!.states;
    if (was.join() === e.states.join()) return [];
    const gained = e.states.filter(x => !was.includes(x)), lost = was.filter(x => !e.states.includes(x));
    return [`${e.name}: ${[...gained, ...lost.map(x => `no longer ${x}`)].join(", ")}`];
  });
  const via = (kind: string) => path.flatMap(p => { const m = new RegExp(`^${n}: .* via (${kind}:\\S+)`).exec(p); return m ? [m[1]!] : []; });
  const act = via("rules")[0], reactions = via("reactions")[0];
  return { world, ...(act ? { act: act.slice("rules:".length) } : {}), ...(reactions ? { reactions: reactions.slice("reactions:".length).split(",").join(", ") } : {}) };
}

/** The game's spend so far, and its dearest turn, in dollars: from the call log, so the notes' and lines' calls count as they're made. */
export function spentOf(root: string, uid: string): { total: number; dearest: number } {
  const byTurn = new Map<number, number>();
  for (const c of callsOf(root, uid)) byTurn.set(c.turn ?? -1, (byTurn.get(c.turn ?? -1) ?? 0) + c.costUsd);
  return { total: [...byTurn.values()].reduce((a, b) => a + b, 0), dearest: Math.max(0, ...byTurn.values()) };
}

/** The GM's side of the game's scene, as npm run status prints it: its rows read as the owner, and the AI service's lines on its memory reviews. */
async function gmSideOf(stack: StackFile, game: NonNullable<Run["game"]>, scene: Row): Promise<Record<string, unknown>> {
  const query = (q: string) => sql(stack.http, q, stack.owner.token);
  return statusOf(await statusRows(query, join(stack.root, "ai", "games", game.uid), { id: String(game.id), uid: game.uid }, scene));
}

/** The scene's background jobs in flight (the memory reviews), as "remember t3". */
export async function backgroundIn(stack: StackFile, sceneId: bigint): Promise<string[]> {
  return backgroundOf(await sql(stack.http, "SELECT * FROM job", stack.owner.token), String(sceneId));
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
    n, ...(from.step ? { step: from.step.step, ...(from.step.said ? { said: from.step.said } : {}), ...(from.step.waitedMs !== undefined ? { waited: from.step.waitedMs } : {}) } : {}),
    saidAt: Number(t.started_at),
    ...(t.first_text_at !== null ? { firstAt: Number(t.first_text_at) } : {}),
    ...(reply ? { finalAt: Number(reply.at) } : {}),
    ...(t.ended_at !== null ? { doneAt: Number(t.ended_at) } : {}),
    ...defined({ linesMs: after(seen.lines) }),
    suggest: String(t.suggest),
    calls: from.calls.filter(c => c.turn === n),
    entries: entries.map(e => entryRecord(e, from.scene)),
    lines: from.run.sets.get(n) ?? [],
    dropped: from.dropped,
  };
}

/** An entry with its markup read: who says each line. */
function entryRecord(e: Row, scene: Scene): EntryRecord {
  const text = String(e.text);
  const markup = (e.markup ? JSON.parse(String(e.markup)) : { speech: [] }) as Markup;
  return { kind: String(e.kind), speaker: String(e.speaker), text, spoken: markup.speech.map(s => spokenOf(s, text, scene)) };
}

function spokenOf(s: Speech, text: string, scene: Scene): Spoken {
  return { who: s.speaker ? nameOf(s.speaker, scene) : "nobody can tell", ...(s.tag ? { tag: s.tag } : {}), text: text.slice(s.start, s.end) };
}

/** Someone by the cast card's name ("kell" is Sergeant Agnes Kell; "you" the player); anyone else by their key. */
const nameOf = (key: string, scene: Scene) => (key === "you" ? "you" : scene.cast.find(c => c.id === key)?.name ?? key);

/** The scene's people's secrets, and the essentials the player hasn't come across (gm_state.landed has those they have). */
function heldFrom(scene: Scene, landed: string[]): Held {
  return {
    secrets: scene.cast.flatMap(c => (c.secrets ?? []).map(text => ({ who: c.name, text }))),
    essentials: (scene.essentials ?? []).filter(e => !landed.includes(e.id)).map(e => ({ what: e.what, with: e.placedWith })),
  };
}

/** The campaign's scene, loaded with its words: what the record names people by and reads secrets from. */
function installedScene(key: string): Scene {
  return loadScene(readCampaignFiles(CAMPAIGN)[scenePath(key)]!, scenePath(key));
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
      key: String(c.key), ...defined({ turn: turnKeyParts(String(c.key))?.turn }), operation: String(c.operation),
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
