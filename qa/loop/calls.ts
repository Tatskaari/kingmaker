import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { turnKeyParts } from "../../shared/protocol/keys.ts";

/**
 * A game's model calls as its stack's AI service logged them (<stack>/ai/games/<uid>/calls.jsonl,
 * ai/service/calls.ts): each line is a call going out (`started`), a try again (`retry`, its status),
 * or a call in full with what came back, or how it failed, every one stamped with the key of the
 * think it was for, `<uid>:s<scene row>:t<turn>:<step>`, so a call is a turn's.
 */

/** A line of the call log, as the report's call viewer reads it (html.ts). */
export interface Call {
  at?: string; key?: string; attempt?: number;
  provider?: string; operation?: string; model?: string; effort?: string;
  request?: { instructions?: string; input?: Array<{ role: string; content: string }>; json?: string | { name?: string }; state?: unknown; questions?: Record<string, { instructions?: string; criteria?: Record<string, string> }> } & Record<string, unknown>;
  text?: string; answers?: Record<string, { choice: string; probabilities?: Record<string, number>; confidence?: number }>;
  calls?: Array<{ name: string; args?: unknown; result?: unknown }>;
  latencyMs?: number; firstTextMs?: number | null; costUsd?: number; tokens?: { in?: number; out?: number; reasoning?: number };
  error?: string; started?: string; retry?: number; status?: number; warning?: string;
}

/** The call log's lines; none when there's no log. A line that isn't JSON is skipped. */
export function readCalls(file: string): Call[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap(line => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line) as Call]; } catch { return []; }
  });
}

/**
 * A game's calls as the round keeps them: its stack's log, copied beside the round as it's read
 * (`kept`), so the round outlives the stack (a fresh start wipes its store) and goes with its archive;
 * the round's copy when the stack's log is gone.
 */
export function keptCalls(stackLog: string, kept: string): Call[] {
  if (existsSync(stackLog)) {
    mkdirSync(dirname(kept), { recursive: true });
    copyFileSync(stackLog, kept);
  }
  return readCalls(kept);
}

/** A call in full: its answer, or how it failed (not one going out, a try again, or a warning). */
export const isWhole = (c: Call) => c.started === undefined && c.retry === undefined && (c.text !== undefined || c.answers !== undefined || c.error !== undefined || c.calls !== undefined);

/** A scene's calls by turn (the opening is turn 0; a scene's boundary is keyed by its last turn), each whole. */
export function callsByTurn(calls: Call[], sceneRow: string): Map<number, Call[]> {
  const turns = new Map<number, Call[]>();
  for (const call of calls.filter(isWhole)) {
    const parts = call.key ? turnKeyParts(call.key) : undefined;
    if (parts?.scene !== sceneRow) continue;
    turns.set(parts.turn, [...(turns.get(parts.turn) ?? []), call]);
  }
  return turns;
}

/** Calls OpenRouter turned away with a 402: the key's in-flight spending cap (in_flight_budget_exhausted), or any other 402. */
export const capped = (calls: Call[]) => calls.filter(c => /\b402\b/.test(c.error ?? "") || c.status === 402).length;

/** What the calls cost, in dollars. */
export const costOf = (calls: Call[]) => calls.reduce((sum, c) => sum + (isWhole(c) ? c.costUsd ?? 0 : 0), 0);

/** The game's calls that aren't the scene's: making its character, and the scenes ended on the way to it. */
export const callsBefore = (calls: Call[], sceneRow: string | undefined) => calls.filter(c => isWhole(c) && (!c.key || turnKeyParts(c.key)?.scene !== sceneRow));
