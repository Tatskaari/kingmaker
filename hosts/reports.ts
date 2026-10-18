// After the prototype's src/report/dump.ts at 44c6d4a, its terminal half: saveUnderRuns (runs/reports/<time>-<game>.json.gz, numbered when the second is taken, and the words to pass on), buildInfo (git's commit, and whether there were changes), environment (KM_* and the terminal's, never a secret's) and keysInUse (OPENROUTER_API_KEY and the dev key file), with the tokens a terminal client knows of beside them.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { Reporting } from "../client/report/file.ts";
import { stampOf, type Build, type Filed, type Settings } from "../shared/report/format.ts";
import { keysFrom } from "../shared/report/redact.ts";

/**
 * Where a terminal's reports of a problem go (V16, M5: docs/migration-log.md), the terminal client's
 * and the headless one's: runs/reports/<time>-game<n>.json.gz, beside the sessions (KM_RUNS_DIR moves
 * both), and the game says so in words to pass on ("Saved runs/reports/<file>: tell Claude 'report
 * <file>'"). What the process says of itself in one: its build (git's commit, and whether there were
 * changes) and settings (the glyphs, the terminal's size, the game's KM_* and the terminal's own),
 * and every key it knows of, to be taken out: OpenRouter's (the environment's, the dev key file's),
 * the AI service's and the module's tokens in the environment, the session's token, and the dev
 * stack's (its owner's, the AI service's identity's and its bearer).
 */

export interface TerminalReports {
  /** runs/ (KM_RUNS_DIR's). */
  runs: string;
  host: "terminal" | "headless";
  env: NodeJS.ProcessEnv;
  /** The session's file (runs/play/<name>.json) and the stack's folder (runs/dev), for the tokens in them. */
  session?: string;
  stack?: string;
  glyphs(): string;
  /** The terminal's size in cells (a headless client has none). */
  size?(): { cols: number; rows: number };
}

/** Where reports are kept on this machine: beside the sessions. */
export const reportsDir = (runs: string) => join(runs, "reports");

/** The dev key file (ai/llm/openrouter.ts reads it when OPENROUTER_API_KEY isn't set). */
const KEY_FILE = () => join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");

/** The repo this game runs from (git is asked about it). */
const REPO = join(import.meta.dirname, "..");

export function terminalReporting(options: TerminalReports): Reporting {
  return {
    build: () => buildOf(options.host),
    settings: () => settingsOf(options),
    keys: () => keysOf(options),
    keep: packed => keepUnder(reportsDir(options.runs), packed),
  };
}

/** runs/reports/<time>-game<n>.json.gz (a second report in the same second gets a number), and what the game says of it. */
function keepUnder(dir: string, report: { bytes: Uint8Array; at: string; game?: string }): Promise<Filed> {
  mkdirSync(dir, { recursive: true });
  const base = `${stampOf(report.at)}-${report.game ? `game${report.game}` : "no-game"}`;
  let file = `${base}.json.gz`;
  for (let n = 2; existsSync(join(dir, file)); n++) file = `${base}-${n}.json.gz`;
  const path = join(dir, file);
  writeFileSync(path, report.bytes);
  const shown = relative(process.cwd(), path);
  return Promise.resolve({ file, path, said: `Saved ${shown.startsWith("..") || isAbsolute(shown) ? path : shown}: tell Claude 'report ${file}'` });
}

function buildOf(host: TerminalReports["host"]): Build {
  const commit = git("rev-parse", "HEAD");
  const changes = git("status", "--porcelain", "--untracked-files=no");
  return {
    host,
    ...(commit ? { commit } : {}),
    ...(changes !== undefined ? { dirty: changes.trim() !== "" } : {}),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
  };
}

function git(...args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return undefined;
  }
}

function settingsOf(options: TerminalReports): Settings {
  const size = options.size?.();
  return { glyphs: options.glyphs(), ...(size ? { terminal: size } : {}), env: environment(options.env) };
}

/** The settings in the environment worth knowing: the game's own (KM_*) and the terminal's. Never anything named like a secret. */
function environment(env: NodeJS.ProcessEnv): Record<string, string> {
  const wanted = /^(KM_|TERM$|TERM_PROGRAM$|COLORTERM$|LANG$|LC_ALL$|NODE_ENV$)/;
  const secret = /KEY|SECRET|TOKEN|PASSWORD/i;
  return Object.fromEntries(Object.entries(env)
    .filter((e): e is [string, string] => e[1] !== undefined && wanted.test(e[0]) && !secret.test(e[0]))
    .sort(([a], [b]) => a.localeCompare(b)));
}

/** Every key this process could know of. */
function keysOf(options: TerminalReports): string[] {
  const env = options.env;
  const stack = options.stack ? jsonIn(join(options.stack, "stack.json")) : undefined;
  const ai = stack?.ai as { token?: string; bearer?: string } | undefined;
  return keysFrom([
    env.OPENROUTER_API_KEY, env.KM_AI_TOKEN, env.KM_STDB_TOKEN, ...devKeys(),
    options.session ? (jsonIn(options.session)?.token as string | undefined) : undefined,
    (stack?.owner as { token?: string } | undefined)?.token, ai?.token, ai?.bearer,
  ]);
}

function devKeys(): string[] {
  try {
    return existsSync(KEY_FILE()) ? readFileSync(KEY_FILE(), "utf8").split("\n").filter(k => k.trim()) : [];
  } catch {
    return [];
  }
}

function jsonIn(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
