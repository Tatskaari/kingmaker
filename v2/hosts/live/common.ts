import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Connection } from "../../client/net/connection.ts";
import { readStackFile, type StackFile } from "../dev/stack-file.ts";

/**
 * What the live runs share (hosts/live-run.ts): the running dev stack, waiting on a turn, the model
 * calls as the AI service's ledger has them, and writing the record.
 */

/** The dev stack stack.json describes, on real models unless this is a rehearsal. */
export function runningStack(root: string, rehearse: boolean): StackFile {
  const stack = readStackFile(root);
  if (!stack?.pids.stdb || !stack.pids.ai) throw new Error(`there's no dev stack running from ${root}: start one with npm run dev`);
  if (stack.ai.model !== "openrouter" && !rehearse) throw new Error("the dev stack runs the fake model: start it with real models (npm run dev), or pass --rehearse to try this run on the fake");
  return stack;
}

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

/** A path as the reader typed it: relative to here when it's under here. */
export function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

export function writeRecord(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
