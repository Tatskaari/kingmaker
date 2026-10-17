import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import type { HomeRows } from "../../client/backend.ts";
import { connect, type Connection, type RowOp, type Watched } from "../../client/net/connection.ts";
import type { SceneRows } from "../../client/scene/rows.ts";
import { run } from "../dev/child.ts";
import type { Stack } from "../dev/stack.ts";

/**
 * What the e2e's steps share (hosts/e2e.ts): saying how a step went, the players and waiting on
 * their rows, and reading the stack's logs. A check that fails throws Failed, in the words of what
 * it looked for; the e2e stops at the first.
 */

/** A check that didn't pass, in the words of what it looked for. */
export class Failed extends Error {}

const began = performance.now();

/** Time since the e2e began. */
export function elapsed(): string {
  return seconds(performance.now() - began);
}

export function step(title: string): void {
  console.log(`\n${title} (${elapsed()})`);
}

export function ok(what: string): void {
  console.log(`  ✓ ${what}`);
}

/** What a step measured, said without a verdict. */
export function note(what: string): void {
  console.log(`  · ${what}`);
}

export function check(what: string, passes: boolean): void {
  if (!passes) throw new Failed(what);
  ok(what);
}

export function pause(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function millis(micros: number): string {
  return `${Math.round(micros / 1000)} ms`;
}

export function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** JSON.stringify's replacer for rows: a u64 as its digits. */
export function bigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? String(value) : value;
}

// ---------------------------------------------------------------------------------------------
// Players, and waiting on their rows.

/** A client and every row event it has seen, in the order it saw them, with when (performance.now()). */
export interface Player { name: string; conn: Connection; events: Array<{ table: Watched; op: RowOp; row: any; at: number }> }

export async function player(stack: Stack, name: string): Promise<Player> {
  const conn = await connect({ url: stack.ws, db: stack.db });
  const events: Player["events"] = [];
  conn.onEvent((table, op, row) => events.push({ table, op, row, at: performance.now() }));
  return { name, conn, events };
}

/** Resolves with what `test` finds in the player's scene rows, once it finds it; a Failed after `ms`. */
export function until<T>(p: Player, what: string, ms: number, test: (rows: SceneRows) => T | undefined | null | false | 0): Promise<T> {
  return waitOn(p, what, ms, () => p.conn.rows(), test, () => JSON.stringify(lastTurn(p), bigints));
}

/** The same for the rows outside a scene (my_creation, my_games, the seat and its sheet). */
export function homeUntil<T>(p: Player, what: string, ms: number, test: (rows: HomeRows) => T | undefined | null | false | 0): Promise<T> {
  return waitOn(p, what, ms, () => p.conn.home(), test, () => JSON.stringify(p.conn.home().creation ?? "no creation", bigints));
}

function waitOn<R, T>(p: Player, what: string, ms: number, read: () => R | undefined, test: (rows: R) => T | undefined | null | false | 0, last: () => string): Promise<T> {
  return new Promise((resolve, reject) => {
    const look = () => {
      const rows = read();
      const found = rows && test(rows);
      if (!found) return;
      clearTimeout(timer);
      stop();
      resolve(found);
    };
    const timer = setTimeout(() => { stop(); reject(new Failed(`${p.name} waited ${seconds(ms)} for ${what}; it last saw: ${last()}`)); }, Math.max(ms, 0));
    const stop = p.conn.onChange(look);
    look();
  });
}

/** Turn n done: its rows once it is; a Failed at once if it fails instead. */
export async function doneTurn(p: Player, n: number, ms = 60_000): Promise<SceneRows> {
  const rows = await until(p, `turn ${n} to finish`, ms, r => ["done", "failed"].includes(turnOf(r, n)?.phase ?? "") && r);
  const turn = turnOf(rows, n)!;
  check(`turn ${n} done`, turn.phase === "done");
  return rows;
}

export function turnOf(rows: SceneRows, n: number) {
  return rows.turns.find(t => t.n === n);
}

export function lastTurn(p: Player) {
  return p.conn.rows()?.turns.reduce<SceneRows["turns"][number] | undefined>((a, t) => (!a || t.n > a.n ? t : a), undefined);
}

export function nextTurn(p: Player): number {
  return (lastTurn(p)?.n ?? 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// The stack: the AI service restarted with other options, the logs, the call log.

/** The AI service stopped (SIGTERM: what's in flight finishes) and started with the fake model's options and anything else. */
export async function restartAi(stack: Stack, fake: FakeOptions, env: Record<string, string> = {}): Promise<void> {
  await stack.ai.stop();
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(fake), ...env });
}

/** A call log's lines for a game (its uid, a creation's too): as each call went out ("started"), and as it came back. */
export function callLog(root: string, uid: string): Array<Record<string, any>> {
  const path = join(root, "ai", "games", uid, "calls.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, any>);
}

/** How many times the AI service asked the model for `operation` under a key: the call log's lines as each call went out. */
export function modelCalls(root: string, uid: string, operation: string, key: string): number {
  return callLog(root, uid).filter(c => c.started && c.operation === operation && c.key === key).length;
}

export function aiLog(root: string): string {
  return readFileSync(join(root, "logs", "ai.log"), "utf8");
}

/** The module's own log (console.info in the module), through the stack's CLI config. */
export async function moduleLog(stack: Stack): Promise<string> {
  const { cli, db } = stack.file();
  const { stdout, stderr } = await run(cli.bin, ["--config-path", cli.config, "logs", db, "-s", cli.server, "--no-config"]);
  return `${stdout}${stderr}`;
}
