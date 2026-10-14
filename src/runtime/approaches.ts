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
   *  resolves it once the co-GM reports back. On-graph turns are normal (background co-GM).
   *  "quick-block": on off-graph turns only, wait (up to a deadline) for the quick co-GM, then
   *  give one reply; other turns are normal. Fits the 5 s budget without a two-part seam. */
  repair: "off" | "background" | "blocking" | "stall" | "quick-block";
  repairEffort?: "low" | "medium" | "high";
  /**
   * Roll for risky attempts no scene route covers. Off by default: rolls belong to plot beats
   * (authored edges), so the player can see why the dice matter (V1 and QA feedback).
   */
  freeformChecks?: boolean;
  /** Which co-GM runs inside the turn (stall/blocking): the full review, or the quick fix. */
  repairKind?: "full" | "quick";
  /** Stall mode: how long the follow-up waits for the co-GM before going ahead without it. */
  repairDeadlineMs?: number;
  /** When the player presses a character for a secret, roll for it (DC from the secret's value and the approach). */
  pressureRolls?: boolean;
  /** Start the GM reply alongside the decision; keep it if the decision changes nothing. */
  speculative?: boolean;
  /** Relocate missed essentials through the per-turn decider (no co-GM, no added latency). */
  deciderRelocation?: boolean;
  /** Hide the scene's essentials from the in-scene GM (baseline for the deviation experiment). */
  hideEssentials?: boolean;
  /** Reasoning effort for the voices (GM, narrator, actors). Default "none" for snappy replies. */
  effort?: "none" | "low" | "medium" | "high";
}

export const APPROACHES: Record<string, Approach> = {
  // Recommended: what the experiments support (docs/experiments/deviation-repair.md). Single GM
  // voice with the scene's essentials in its prep; speculative replies; on a turn the decider judges
  // off the graph, wait up to 3 s for the quick co-GM (routes with rolls, relocations), then one reply;
  // the full co-GM reviews in the background between turns.
  v2: { id: "v2", description: "Recommended: GM voice, speculative replies, quick co-GM on off-graph turns (3 s), background co-GM.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, speculative: true },
  "v2-pressure": { id: "v2-pressure", description: "v2 plus pressure rolls: pressing someone for a secret is rolled, DC from the secret's value and the player's approach.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, speculative: true, pressureRolls: true },
  "gm-rigid": { id: "gm-rigid", description: "Baseline: single GM voice without the scene's essentials and without a co-GM.", voice: "gm", decider: "luna-decisions", repair: "off", hideEssentials: true },
  gm: { id: "gm", description: "Single GM voice; Luna decision mode tracks beats, rolls and exits.", voice: "gm", decider: "luna-decisions", repair: "off" },
  "gm-jev": { id: "gm-jev", description: "Single GM voice; Jev tracks beats, rolls and exits.", voice: "gm", decider: "jev", repair: "off" },
  "gm-luna": { id: "gm-luna", description: "Single GM voice; Luna structured output (no reasoning) tracks beats.", voice: "gm", decider: "luna-none", repair: "off" },
  "gm-low": { id: "gm-low", description: "Single GM voice with Luna reasoning 'low' (quality vs latency).", voice: "gm", decider: "luna-decisions", repair: "off", effort: "low" },
  "gm-medium": { id: "gm-medium", description: "Single GM voice with Luna reasoning 'medium' (quality vs latency).", voice: "gm", decider: "luna-decisions", repair: "off", effort: "medium" },
  "gm-repair": { id: "gm-repair", description: "Single GM voice plus the background co-GM repair agent.", voice: "gm", decider: "luna-decisions", repair: "background" },
  "gm-repair-blocking": { id: "gm-repair-blocking", description: "Single GM voice; the co-GM reviews every player turn before the reply (accuracy upper bound, slower).", voice: "gm", decider: "luna-decisions", repair: "blocking" },
  "gm-repair-stall": { id: "gm-repair-stall", description: "Single GM voice; off-graph turns get a quick holding beat while the co-GM works, then a follow-up that resolves them.", voice: "gm", decider: "luna-decisions", repair: "stall" },
  "gm-stall-quick": { id: "gm-stall-quick", description: "5 s budget: off-graph turns get a holding beat while a quick co-GM (3 s deadline) decides; speculative replies; decider relocation.", voice: "gm", decider: "luna-decisions", repair: "stall", repairKind: "quick", repairDeadlineMs: 3000, speculative: true, deciderRelocation: true },
  "gm-quick-block": { id: "gm-quick-block", description: "5 s budget: on off-graph turns, wait up to 3 s for the quick co-GM (new routes with rolls, relocations), then one coherent reply; speculative replies and decider relocation otherwise.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, speculative: true, deciderRelocation: true },
  "gm-fast": { id: "gm-fast", description: "Single GM voice with speculative replies: the reply starts alongside the decision and is kept when the decision changes nothing.", voice: "gm", decider: "luna-decisions", repair: "off", speculative: true },
  "gm-nudge": { id: "gm-nudge", description: "Single GM voice; the per-turn decider moves missed essentials to whoever the player is engaging with (no co-GM).", voice: "gm", decider: "luna-decisions", repair: "off", deciderRelocation: true },
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
