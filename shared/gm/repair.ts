// Copied from the prototype's src/runtime/session.ts:210-229 (RepairResult) at 44c6d4a, the type alone: without `quick` (the quick co-GM isn't ported: v2 repairs in the background only), ScenePatch from ./state.ts.

import type { ScenePatch } from "./state.ts";

/**
 * The background co-GM's review of a turn (the AI service's repair.ts makes it; the simulation keeps
 * it in a co_gm_result row until the next turn's start merges it into the GM's bookkeeping).
 */
export interface RepairResult {
  /** Turn the repair agent analysed. */
  turn: number;
  assessment: string;
  status: "on_track" | "drifting" | "stuck";
  notes: string;
  /** Per-character steering for the next exchange or two. */
  whispers?: Array<{ to: string; note: string }>;
  /** Essentials the co-GM moved because play went elsewhere. */
  relocations?: Array<{ essential: string; technique: string; to: string; how: string }>;
  canon: string[];
  patches: ScenePatch[];
  /** A beat the story has reached, if the tracker is behind; and what has happened that puts it there (a fact, once it moves). */
  moveTo?: string;
  moveBecause?: string;
  costUsd: number;
  latencyMs: number;
}
