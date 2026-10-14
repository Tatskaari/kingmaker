/**
 * Each approach is a runnable PoC: the same scenes, different orchestration.
 * - voice "gm": one Luna call per turn; the GM narrates and voices everyone (Friends & Fables style).
 * - voice "actors": a decider picks who speaks; each character is a separate Luna call that only
 *   knows what that character knows; the GM narrates the world between them.
 * - decider: who judges beat transitions, rolls and speakers. "luna-decisions" is Luna's decision
 *   mode on the Decisions API (best accuracy and latency in the decision suite); "jev" is TypeSafe
 *   Jev on the same API; "luna-none" is Luna with strict structured output.
 * - repair: the co-GM agent reviews the scene between turns and leaves notes and graph patches.
 */
export interface Approach {
  id: string;
  description: string;
  voice: "gm" | "actors";
  decider: string;
  /** "background": the co-GM reviews after a turn, its output lands next turn (never blocks).
   *  "blocking": it reviews the player's input before the reply (upper bound on repair, slower).
   *  "stall": when the player goes off the graph, the GM replies at once with a short beat that
   *  takes it seriously without resolving it, the co-GM works in parallel, and a follow-up reply
   *  resolves it once the co-GM reports back. On-graph turns are normal (background co-GM). */
  repair: "off" | "background" | "blocking" | "stall";
  repairEffort?: "low" | "medium" | "high";
  /**
   * Roll for risky attempts no scene route covers. Off by default: rolls belong to plot beats
   * (authored edges), so the player can see why the dice matter (V1 and QA feedback).
   */
  freeformChecks?: boolean;
  /** Hide the scene's essentials from the in-scene GM (baseline for the deviation experiment). */
  hideEssentials?: boolean;
  /** Reasoning effort for the voices (GM, narrator, actors). Default "none" for snappy replies. */
  effort?: "none" | "low" | "medium" | "high";
}

export const APPROACHES: Record<string, Approach> = {
  "gm-rigid": { id: "gm-rigid", description: "Baseline: single GM voice without the scene's essentials and without a co-GM.", voice: "gm", decider: "luna-decisions", repair: "off", hideEssentials: true },
  gm: { id: "gm", description: "Single GM voice; Luna decision mode tracks beats, rolls and exits.", voice: "gm", decider: "luna-decisions", repair: "off" },
  "gm-jev": { id: "gm-jev", description: "Single GM voice; Jev tracks beats, rolls and exits.", voice: "gm", decider: "jev", repair: "off" },
  "gm-luna": { id: "gm-luna", description: "Single GM voice; Luna structured output (no reasoning) tracks beats.", voice: "gm", decider: "luna-none", repair: "off" },
  "gm-low": { id: "gm-low", description: "Single GM voice with Luna reasoning 'low' (quality vs latency).", voice: "gm", decider: "luna-decisions", repair: "off", effort: "low" },
  "gm-medium": { id: "gm-medium", description: "Single GM voice with Luna reasoning 'medium' (quality vs latency).", voice: "gm", decider: "luna-decisions", repair: "off", effort: "medium" },
  "gm-repair": { id: "gm-repair", description: "Single GM voice plus the background co-GM repair agent.", voice: "gm", decider: "luna-decisions", repair: "background" },
  "gm-repair-blocking": { id: "gm-repair-blocking", description: "Single GM voice; the co-GM reviews every player turn before the reply (accuracy upper bound, slower).", voice: "gm", decider: "luna-decisions", repair: "blocking" },
  "gm-repair-stall": { id: "gm-repair-stall", description: "Single GM voice; off-graph turns get a quick holding beat while the co-GM works, then a follow-up that resolves them.", voice: "gm", decider: "luna-decisions", repair: "stall" },
  "gm-repair-low": { id: "gm-repair-low", description: "Background co-GM at low reasoning (faster notes).", voice: "gm", decider: "luna-decisions", repair: "background", repairEffort: "low" },
  "gm-repair-stall-low": { id: "gm-repair-stall-low", description: "Stall and report back, with the co-GM at low reasoning (faster follow-up).", voice: "gm", decider: "luna-decisions", repair: "stall", repairEffort: "low" },
  actors: { id: "actors", description: "A decider picks who speaks; each character is its own Luna actor; GM narrates.", voice: "actors", decider: "luna-decisions", repair: "off" },
  "actors-jev": { id: "actors-jev", description: "Actors with Jev choosing speakers and tracking beats.", voice: "actors", decider: "jev", repair: "off" },
  "actors-repair": { id: "actors-repair", description: "Actors plus the background co-GM repair agent.", voice: "actors", decider: "luna-decisions", repair: "background" },
};

export function approachById(id: string): Approach {
  const approach = APPROACHES[id];
  if (!approach) throw new Error(`Unknown approach ${id}. Known: ${Object.keys(APPROACHES).join(", ")}`);
  return approach;
}
