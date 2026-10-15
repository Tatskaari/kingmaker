import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { costLedger } from "../llm/openrouter.ts";
import { runsDir, sessionDir } from "../runtime/session.ts";
import { keyInUse, keysInUse, redact, redactScreen } from "./redact.ts";
import { recentErrors, recentScreens, type NotedError, type NotedScreen } from "./recent.ts";

/**
 * A report of a problem, from the game (src/report/README.md): one file, gzipped JSON, with what the
 * player said, the build and the settings, where they were and what was on screen, the game's
 * files (its saves, the last snapshots, every model call, the GM's notes, the docs it wrote), this
 * game's lines of the cost ledger, and the errors caught along the way. Never the key: it's taken
 * out of everything before the file is written (redact.ts).
 *
 * The terminal app and the server's games save it under runs/reports/; the static build hands it to
 * the page, which downloads it (setReportSink). `npm run report` reads it (src/cli/report.ts).
 */

export const REPORT_KIND = "kingmaker-report";
export const REPORT_FORMAT = 1;
/** How many model calls a report keeps: all of them, up to this many (the latest). */
export const KEEP_CALLS = 300;
/** How many of the game's per-turn snapshots it keeps (the latest). */
export const KEEP_SNAPSHOTS = 10;

export interface Dump {
  kind: typeof REPORT_KIND;
  format: typeof REPORT_FORMAT;
  /** What the player said went wrong. */
  words: string;
  /** When they said it. */
  at: string;
  build: Build;
  settings: Settings;
  where: Where;
  /** What was on screen as they asked to report it, and the last few screens before it, as text. */
  screens: { now?: string; recent: NotedScreen[] };
  /** The game reported on, if there was one. */
  game?: GameFiles;
  /** Errors caught or logged since the game started (the newest last), with their stacks. */
  errors: NotedError[];
  /** A zoo visit's own state: the wing, the exhibits seen, the last thing set off. */
  zoo?: Record<string, unknown>;
  /** How many keys (or key-shaped strings) were taken out of it. */
  redacted: number;
}

export interface Build {
  /** Which game it is: the terminal app, the server's (npm run web) or the static build's (the PR previews). */
  host: "terminal" | "server" | "static";
  /** The git commit it was built from (the static build's is written in when it's built). */
  commit?: string;
  /** It had changes beyond the commit. */
  dirty?: boolean;
  /** The static build's stamp (its <html data-build>). */
  stamp?: string;
  /** Node's version and the platform (not in a browser: its user agent says what it is). */
  node?: string;
  platform?: string;
  /** The save formats it writes. */
  formats: { report: number; game: number; app: number };
}

export interface Settings {
  approach?: string;
  glyphs?: string;
  /** The terminal's size, in cells (the browser's terminal, in a browser). */
  terminal?: { cols: number; rows: number };
  /** The browser's window: its size in CSS pixels and its device pixel ratio ("1280x800@2"). */
  window?: string;
  userAgent?: string;
  /** Playing without the GM: no OpenRouter key (none at all, or an offline stand-in). */
  offline: boolean;
  /** The game's own settings (KM_*) and the terminal's (TERM, COLORTERM, LANG): never a key. */
  env: Record<string, string>;
}

export interface Where {
  /** The app's screen it was reported from: title, explore, scene, between, combat or end ("saves": made from the saves, by npm run report -- make). */
  screen: string;
  /** What was open over it (the sheet, the help, the notebook, the action menu...). */
  overlay?: string;
  /** A turn was being played: what the screen said ("The GM is thinking…"). */
  busy?: string;
  /** The game's last word on the screen. */
  status?: string;
  /** The scene on screen was over, waiting for the player to go on: how it ended. */
  over?: string;
  /** The fight on screen: its round and whose turn it was. */
  fight?: { round: number; turn?: string };
  /** From the title: the game reported on is the latest one played. */
  latest?: boolean;
  /** Where the game is, as its files have it. */
  place?: Place;
}

export interface Place {
  player?: string;
  mode?: string;
  hub?: string;
  scene?: string;
  beat?: string;
  turn?: number;
  turnsInBeat?: number;
  /** The scene has ended (its exit), and the story hasn't moved on yet. */
  ended?: string;
  /** In a talk with a companion (who). */
  talk?: string;
  /** A fight that broke out on the map (not a scene's): it ends back on the map. */
  fightOnMap?: boolean;
  time?: string;
  lead?: string;
  map?: string;
  at?: { x: number; y: number };
}

export interface GameFiles {
  id: string;
  /** game.json, state.json and app.json, as saved. A file that couldn't be read is kept as text ({ unreadable }). */
  files: { game?: unknown; state?: unknown; app?: unknown };
  /** The game and its session in memory, when a turn was under way as it was reported (they're saved once it's over). */
  live?: { game: unknown; session: unknown };
  /** The latest per-turn snapshots (runs/sessions/<id>/snapshots), oldest first. */
  snapshots: Array<{ name: string; mtime: string; state: unknown }>;
  /** calls.jsonl: every model call, with its prompts and reply (the latest KEEP_CALLS when there are more). */
  calls: { total: number; kept: Array<Record<string, unknown>> };
  /** memory-reviews.jsonl: the GM's notes on each turn (what people remember). */
  memoryReviews: unknown[];
  /** The co-GM's reviews (repair-NNN.json, and a quick co-GM's that came too late, repair-NNN-quick.json). */
  repairs: Array<{ name: string; repair: unknown }>;
  /** The docs overlay: the lore and memories this game wrote (runs/sessions/<id>/docs). */
  docs: Array<{ path: string; text: string }>;
  /** This game's lines of the cost ledger (runs/cost-ledger.jsonl). */
  ledger: Array<Record<string, unknown>>;
  /** Anything else in the game's folder, by name (a background job's lock file says it was still running). */
  others: string[];
}

export interface ReportInput {
  /** What the player said went wrong. */
  words: string;
  /** The game reported on: its files are read from runs/sessions/<id>. None: no game yet. */
  session?: string;
  /** Where the app was (the rest of where comes from the game's files). */
  where: Where;
  /** What was on screen as the player asked to report it. */
  screen?: string;
  /** The game and its session in memory, when a turn was under way. */
  live?: { game: unknown; session: unknown };
  terminal?: { cols: number; rows: number };
  glyphs?: string;
}

/** Where a report went, and what the game says of it. */
export interface Filed {
  /** The report's file name: what to tell Claude. */
  file: string;
  /** What the game says ("Saved runs/reports/<file>: tell Claude 'report <file>'"). */
  said: string;
  /** The file on this machine's disk, when it's there. */
  path?: string;
}

/** Where a report goes: under runs/reports (the terminal app, the server's games), or the static build's download. */
export type ReportSink = (report: { bytes: Uint8Array; at: string; session?: string }) => Promise<Filed>;

// ---------------------------------------------------------------------------------------------
// Filing a report

let sink: ReportSink = saveUnderRuns;

/** Send reports somewhere else (the static build: to the page, to download); undefined for runs/reports again. */
export function setReportSink(next: ReportSink | undefined): void {
  sink = next ?? saveUnderRuns;
}

/** A report: made, every key taken out of it, gzipped, and filed. */
export async function fileReport(input: ReportInput): Promise<Filed> {
  const dump = makeDump(input);
  const { bytes } = await packDump(dump);
  return sink({ bytes, at: dump.at, ...(input.session ? { session: input.session } : {}) });
}

/** Where reports are kept on this machine: beside the sessions (KM_RUNS_DIR moves both). */
export const reportsDir = () => join(runsDir(), "reports");

/** runs/reports/<time>-<game>.json.gz (a second report in the same second gets a number). */
async function saveUnderRuns(report: { bytes: Uint8Array; at: string; session?: string }): Promise<Filed> {
  const dir = reportsDir();
  mkdirSync(dir, { recursive: true });
  const base = `${stampOf(report.at)}-${report.session ?? "no-game"}`;
  let file = `${base}.json.gz`;
  for (let n = 2; existsSync(join(dir, file)); n++) file = `${base}-${n}.json.gz`;
  const path = join(dir, file);
  writeFileSync(path, report.bytes);
  const shown = relative(process.cwd(), path);
  return { file, path, said: `Saved ${shown.startsWith("..") || isAbsolute(shown) ? path : shown}: tell Claude 'report ${file}'` };
}

/** A time as the session ids have it: 20261015-150233 (UTC). */
export const stampOf = (iso: string) => iso.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-").replace(/Z$/, "");

// ---------------------------------------------------------------------------------------------
// Making one

/** Everything a report holds, read now: the build, the settings, where, the screens, the game's files, the errors. */
export function makeDump(input: ReportInput): Dump {
  const game = input.session ? gameFiles(input.session, input.live) : undefined;
  const place = game ? placeOf(game) : undefined;
  const zoo = game ? zooOf(game) : undefined;
  return {
    kind: REPORT_KIND,
    format: REPORT_FORMAT,
    words: input.words.trim(),
    at: new Date().toISOString(),
    build: buildInfo(),
    settings: settingsOf(input, game),
    where: { ...input.where, ...(place ? { place } : {}) },
    screens: screensOf(input),
    ...(game ? { game } : {}),
    errors: recentErrors(),
    ...(zoo ? { zoo } : {}),
    redacted: 0,
  };
}

/**
 * The report as a file's bytes: every key taken out (the keys in use, and anything key-shaped,
 * anywhere in it), then gzipped with CompressionStream, which the browser has too.
 */
export async function packDump(dump: Dump, keys: string[] = keysInUse()): Promise<{ bytes: Uint8Array; removed: number }> {
  const { redacted: _, ...rest } = dump;
  const { text, removed } = redact(JSON.stringify(rest), keys);
  const json = `${text.slice(0, -1)},"redacted":${removed}}`;
  return { bytes: await gzip(json), removed };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The game's folder: its saves, snapshots, calls, notes, docs, and its lines of the ledger. */
function gameFiles(id: string, live: ReportInput["live"]): GameFiles {
  const dir = sessionDir(id);
  const calls = jsonLines(join(dir, "calls.jsonl")) as Array<Record<string, unknown>>;
  return {
    id,
    files: { game: jsonFile(join(dir, "game.json")), state: jsonFile(join(dir, "state.json")), app: jsonFile(join(dir, "app.json")) },
    ...(live ? { live } : {}),
    snapshots: snapshotsOf(join(dir, "snapshots")),
    calls: { total: calls.length, kept: calls.slice(-KEEP_CALLS) },
    memoryReviews: jsonLines(join(dir, "memory-reviews.jsonl")),
    repairs: filesIn(dir).filter(f => /^repair-\d+(?:-quick)?\.json$/.test(f)).sort().map(name => ({ name, repair: jsonFile(join(dir, name)) })),
    docs: docsOf(join(dir, "docs")),
    ledger: ledgerOf(id, calls),
    others: filesIn(dir).filter(f => !KNOWN.test(f)).sort(),
  };
}

/** What a game's folder is expected to hold (the rest is listed by name). */
const KNOWN = /^(game\.json|state\.json|app\.json|calls\.jsonl|memory-reviews\.jsonl|repair-\d+(?:-quick)?\.json|snapshots|docs)$/;

/** A JSON file, parsed; one that doesn't parse is kept as its text, which is what matters when a save is broken. */
function jsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  try { return JSON.parse(text); } catch (error) { return { unreadable: text, error: (error as Error).message }; }
}

/** A JSONL file, a value a line (a line that doesn't parse is kept as its text). */
function jsonLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(line => line.trim()).map(line => {
    try { return JSON.parse(line) as unknown; } catch { return { unreadable: line }; }
  });
}

function filesIn(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

/** The latest snapshots, by when they were written (a turn's is written as it ends), oldest first. */
function snapshotsOf(dir: string): GameFiles["snapshots"] {
  const found = filesIn(dir).filter(f => f.endsWith(".json")).map(name => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
  found.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  return found.slice(-KEEP_SNAPSHOTS).map(f => ({ name: f.name, mtime: new Date(f.mtimeMs).toISOString(), state: jsonFile(join(dir, f.name)) }));
}

/** Every file of the docs overlay, by its path in the lore (forward slashes). */
function docsOf(root: string, dir = ""): GameFiles["docs"] {
  const out: GameFiles["docs"] = [];
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...docsOf(root, path));
    else out.push({ path, text: readFileSync(join(root, path), "utf8") });
  }
  return out;
}

/**
 * This game's lines of the cost ledger: those that name it, and (the ledger named no game before
 * reports did) those of its time that match one of its calls (operation, cost and latency).
 */
function ledgerOf(id: string, calls: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const file = costLedger();
  if (!existsSync(file)) return [];
  const named = `"session":${JSON.stringify(id)}`;
  const span = spanOf(calls);
  const ours = new Set(calls.map(signature));
  const out: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const mine = line.includes(named);
    if (!mine && (line.includes('"session":') || !span)) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const at = String(entry["at"] ?? "");
    if (mine || (at >= span!.from && at <= span!.to && ours.has(signature(entry)))) out.push(entry);
  }
  return out;
}

const signature = (e: Record<string, unknown>) => `${String(e["operation"])}|${Number(e["costUsd"] ?? 0)}|${Math.round(Number(e["latencyMs"] ?? 0))}`;

/** The time the calls span, from the first one's start to the last one's end, with a little either side. */
function spanOf(calls: Array<Record<string, unknown>>): { from: string; to: string } | undefined {
  const times = calls.map(c => Date.parse(String(c["at"] ?? ""))).filter(Number.isFinite);
  if (!times.length) return undefined;
  return { from: new Date(Math.min(...times) - 5_000).toISOString(), to: new Date(Math.max(...times) + 5_000).toISOString() };
}

// ---------------------------------------------------------------------------------------------
// What the report says about the game, the build and the settings

interface GameView {
  hub?: string; mode?: string; fightOnMap?: boolean; story?: { time?: string; lead?: string };
  explore?: { ex?: { map?: string; at?: { x: number; y: number } }; zoo?: Record<string, unknown> };
}
interface SessionView {
  approach?: string; sceneId?: string; beat?: string; turn?: number; turnsInBeat?: number;
  player?: { name?: string; build?: string }; ended?: { exitId?: string }; talk?: { with?: string };
}

const viewsOf = (game: GameFiles) => ({
  g: (game.live?.game ?? game.files.game) as GameView | undefined,
  s: (game.live?.session ?? game.files.state) as SessionView | undefined,
});

/** Where the game is, as its files (or, mid-turn, its memory) have it. */
function placeOf(game: GameFiles): Place {
  const { g, s } = viewsOf(game);
  const ex = g?.explore?.ex;
  const place: Place = {
    player: s?.player?.name, mode: g?.mode, hub: g?.hub, scene: s?.sceneId, beat: s?.beat, turn: s?.turn, turnsInBeat: s?.turnsInBeat,
    ended: s?.ended?.exitId, talk: s?.talk?.with, fightOnMap: g?.fightOnMap, time: g?.story?.time, lead: g?.story?.lead, map: ex?.map, at: ex?.at,
  };
  return Object.fromEntries(Object.entries(place).filter(([, v]) => v !== undefined)) as Place;
}

/** A zoo visit's own state: the wing the visitor is in, what they've seen, the last thing set off. */
function zooOf(game: GameFiles): Record<string, unknown> | undefined {
  const { g } = viewsOf(game);
  if (g?.hub !== "zoo") return undefined;
  return { wing: g.explore?.ex?.map, ...(g.explore?.zoo ?? {}) };
}

function buildInfo(): Build {
  const host = process.env.KM_HOST === "static" ? "static" : process.env.KM_HOST === "server" || process.env.KM_IN_BROWSER === "1" ? "server" : "terminal";
  const commit = process.env.KM_BUILD_COMMIT || (host === "static" ? undefined : git("rev-parse", "HEAD"));
  const changes = host === "static" ? process.env.KM_BUILD_DIRTY : git("status", "--porcelain", "--untracked-files=no");
  return {
    host,
    ...(commit ? { commit } : {}),
    ...(changes !== undefined ? { dirty: changes.trim() !== "" } : {}),
    ...(process.env.KM_BUILD_STAMP ? { stamp: process.env.KM_BUILD_STAMP } : {}),
    ...(host === "static" ? {} : { node: process.version, platform: `${process.platform} ${process.arch}` }),
    formats: { report: REPORT_FORMAT, game: 1, app: 2 },
  };
}

/** The repo this game runs from (git is asked about it). */
const REPO = join(import.meta.dirname, "..", "..");

function git(...args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return undefined;
  }
}

function settingsOf(input: ReportInput, game: GameFiles | undefined): Settings {
  const s = game ? viewsOf(game).s : undefined;
  return {
    ...(s?.approach ? { approach: s.approach } : {}),
    ...(input.glyphs ?? process.env.KM_GLYPHS ? { glyphs: input.glyphs ?? process.env.KM_GLYPHS } : {}),
    ...(input.terminal ? { terminal: input.terminal } : {}),
    ...(process.env.KM_WINDOW ? { window: process.env.KM_WINDOW } : {}),
    ...(process.env.KM_BROWSER_UA ? { userAgent: process.env.KM_BROWSER_UA } : {}),
    // The GM speaks only with an OpenRouter key (the smoke test's stand-in isn't one).
    offline: !keyInUse()?.startsWith("sk-or-"),
    env: environment(),
  };
}

/** The settings in the environment worth knowing: the game's own (KM_*) and the terminal's. Never anything named like a secret. */
function environment(): Record<string, string> {
  const wanted = /^(KM_|TERM$|TERM_PROGRAM$|COLORTERM$|LANG$|LC_ALL$|NODE_ENV$)/;
  const secret = /KEY|SECRET|TOKEN|PASSWORD/i;
  const known = new Set(["KM_BROWSER_UA", "KM_WINDOW", "KM_BUILD_COMMIT", "KM_BUILD_DIRTY", "KM_BUILD_STAMP"]);
  return Object.fromEntries(Object.entries(process.env)
    .filter((e): e is [string, string] => e[1] !== undefined && wanted.test(e[0]) && !secret.test(e[0]) && !known.has(e[0]))
    .sort(([a], [b]) => a.localeCompare(b)));
}

/** The screens: as it was, and the last few before it, with anything like a key on them left out. */
function screensOf(input: ReportInput): Dump["screens"] {
  const keys = keysInUse();
  return {
    ...(input.screen ? { now: redactScreen(input.screen, keys) } : {}),
    recent: recentScreens().map(s => ({ ...s, text: redactScreen(s.text, keys) })),
  };
}
