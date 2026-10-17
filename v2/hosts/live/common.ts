import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Connection } from "../../client/net/connection.ts";

/**
 * What the live runs share (hosts/live-run.ts; the running dev stack is live/stack.ts's): waiting on
 * a turn, the model calls as the AI service's ledger has them, a transcript's entries, and writing
 * the record, never over one already there unless told to.
 */

/** Resolves once the seat's turn n is done; throws if it fails, or takes more than three minutes. */
export function settled(conn: Connection, n: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const look = () => {
      const phase = conn.rows()?.turns.find(t => t.n === n)?.phase;
      if (phase !== "done" && phase !== "failed") return;
      clearTimeout(timer);
      stop();
      if (phase === "done") resolve();
      else reject(new Error(`turn ${n} failed: ${conn.rows()!.turns.find(t => t.n === n)!.error}`));
    };
    const timer = setTimeout(() => { stop(); reject(new Error(`turn ${n} wasn't done in three minutes`)); }, 180_000);
    const stop = conn.onChange(look);
    look();
  });
}

/** A model call, as the AI service's ledger has it: the key it was for, what it was, the model, its cost and time. */
export interface Call { key: string; game: string; operation: string; model: string; costUsd: number; latencyMs: number }

/** The AI service's ledger, read on from where a run began: the calls it made since, whatever game or creation they were for. */
export function ledgerFrom(root: string): { calls(): Call[]; spent(): number } {
  const path = join(root, "ai", "ledger.jsonl");
  const from = existsSync(path) ? statSync(path).size : 0;
  const calls = (): Call[] => {
    if (!existsSync(path)) return [];
    return readFileSync(path).subarray(from).toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, any>)
      .filter(c => typeof c.costUsd === "number" && c.key)
      .map(c => ({ key: String(c.key), game: String(c.game ?? ""), operation: String(c.operation), model: String(c.model ?? "?"), costUsd: c.costUsd, latencyMs: Number(c.latencyMs ?? 0) }));
  };
  return { calls, spent: () => calls().reduce((sum, c) => sum + c.costUsd, 0) };
}

/** The calls by operation, a table's rows: how many, what they cost, their median time. */
export function byOperation(calls: Call[]): string[] {
  const groups = new Map<string, Call[]>();
  for (const c of calls) groups.set(c.operation, [...(groups.get(c.operation) ?? []), c]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([operation, cs]) => {
    const times = cs.map(c => c.latencyMs).sort((a, b) => a - b);
    return `| ${operation} | ${cs.length} | $${cs.reduce((s, c) => s + c.costUsd, 0).toFixed(4)} | ${(times[Math.floor(times.length / 2)]! / 1000).toFixed(1)} s |`;
  });
}

/** The models each operation went to, a line each (the disclosures as one). */
export function modelsOf(calls: Call[]): string[] {
  return [...new Set(calls.map(c => `${c.operation.replace(/^memory\.disclose\..*/, "memory.disclose.*")}: ${c.model}`))].sort().map(m => `- ${m}`);
}

/** Text for a table's cell: its bars escaped, its lines run together. */
export function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

/** A transcript's entry, as the records print it: the player's line with its turn, a roll in italics, a system line set apart. */
export function entryText(e: { turn: number; kind: string; text: string }): string {
  if (e.kind === "player") return `> **Turn ${e.turn}.** ${e.text}`;
  if (e.kind === "roll") return `*${e.text}*`;
  if (e.kind === "system") return `**— ${e.text} —**`;
  return e.text;
}

/** A path as the reader typed it: relative to here when it's under here. */
export function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

/** Where a run's record goes: the path, whether --out gave it, and whether --force may write over one there. */
export interface RecordAt { out: string; outGiven: boolean; force: boolean }

/** An --out already there is refused before anything is played (or spent), unless --force. */
export function refuseTakenOut(at: RecordAt): void {
  if (at.outGiven && !at.force && existsSync(at.out)) throw new Error(`${shown(at.out)} is already there: pass --force to write over it, or another --out`);
}

/**
 * The record written, never over one already there unless --force says so: the day's record, if
 * it's there, gets one beside it (v1-<date>-2.md, -3, …). Says where it went, and why there.
 */
export function writeRecord(at: RecordAt, text: string): string {
  const out = at.outGiven || at.force ? at.out : besideAny(at.out);
  const over = at.force && existsSync(out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, { flag: at.force ? "w" : "wx" });
  return `${shown(out)}${out !== at.out ? ` (${shown(at.out)} is already there: this is beside it)` : over ? " (over the record that was there)" : ""}`;
}

/** The path, or the first free one beside it: v1-<date>-2.md, -3, … */
function besideAny(path: string): string {
  const free = (n: number): string => {
    const next = n === 1 ? path : path.replace(/(\.md)?$/, `-${n}$1`);
    return existsSync(next) ? free(n + 1) : next;
  };
  return free(1);
}
