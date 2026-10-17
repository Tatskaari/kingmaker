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
  /** The decider flags daft or reckless acts the world would answer, and the GM is told to follow them through. */
  consequences?: boolean;
  /**
   * Considered rolls (src/runtime/consider.ts): the decider flags an act a roll should settle that
   * none of the scene's routes does (and a plan off the graph), in the call it makes anyway; on
   * those turns only, the GM reviews it before replying: a roll or not, the skill and the DC (from
   * docs/research/dc-guidance.md), and what success and failure each change in the scene (a beat,
   * something coming out, someone acting on it, a route opened or closed). The rules roll, the
   * outcome's changes apply, and the reply plays what was decided. Those turns take longer (the
   * app says the GM is considering); it replaces the quick co-GM's wait and the stall.
   */
  considered?: boolean;
  /**
   * "docs": the docs service (after V1). Each character has a memory index, played scenes leave a
   * story note, Jev opens the relevant notes each turn (progressive disclosure), and background
   * reviews fired by attention flags write first-person memories. Otherwise: prose hand-offs only.
   */
  memory?: "docs" | "lite";
  /**
   * Staged secrets (docs/research/pacing.md, mechanism B): the after-reply decision tracks how far
   * each secret-holder has opened up (surface, tell, stirred, torn, settled) and the GM moves them
   * one step per reply at most, unless the player brings proof or real leverage.
   */
  staging?: boolean;
  /** House style for the GM voice: "comic" adds v2/ai/prompts/tone-comic.md (Pratchett / Monty Python). */
  tone?: "comic";
  /**
   * Guidance for improvising from the prep: "improv" adds prompts/gm-improv.md to the GM's
   * instructions (the person before the purpose, hints before answers, where each thing someone says
   * comes from, the player's words as theirs, moving the story on) and prompts/gm-improv-remind.md
   * just before each reply's directives.
   */
  guide?: "improv";
  /** Reasoning effort for the voices (GM, narrator, actors). Default "none" for snappy replies. */
  effort?: "none" | "low" | "medium" | "high";
}

export const APPROACHES: Record<string, Approach> = {
  // Recommended: what the experiments support (docs/experiments/deviation-repair.md). Single GM
  // voice with the scene's essentials in its prep. A turn whose act a roll should settle and no
  // route does (or a plan off the graph) is considered: the GM rules on it before replying (a roll
  // or not, the DC, what each outcome changes), and the reply plays what was decided; those turns
  // take longer. The full co-GM reviews in the background between turns. No speculative replies:
  // one started before the decision was sometimes shown and then taken back.
  v2: { id: "v2", description: "Recommended: GM voice in the comic house style with consequences, V1's docs-service memory (lore, per-character memories, Jev disclosure, background reviews), the improvisation guide (prompts/gm-improv.md), considered rolls (an act a roll should settle that no route covers is ruled on by the GM before the reply: the roll, the DC, what success and failure change), background co-GM.", voice: "gm", decider: "luna-decisions", repair: "background", tone: "comic", consequences: true, memory: "docs", considered: true, guide: "improv" },
  // v2 as it was before considered rolls, to compare against: off-graph turns wait up to 3 s for the
  // quick co-GM (routes with rolls), and a risky attempt no route covers gets a freeform roll.
  "v2-quick": { id: "v2-quick", description: "v2 before considered rolls: quick co-GM on off-graph turns (3 s), freeform rolls for risky attempts no route covers, background co-GM.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true, memory: "docs", freeformChecks: true },
  "v2-staged": { id: "v2-staged", description: "The quick-co-GM v2 plus staged secrets: people open up one step per reply (a tell, guard up, torn, then told, bargained or refused).", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true, memory: "docs", staging: true },
  "v2-nomemory": { id: "v2-nomemory", description: "v2 without the docs service: prose hand-offs between scenes only.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true },
  "v2-memory": { id: "v2-memory", description: "v2 plus V1's docs service: lore and per-character memories, Jev opens what matters each turn, Jev-flagged background reviews write memories and record improvised details into the lore.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true, memory: "docs" },
  "v2-memory-lite": { id: "v2-memory-lite", description: "Alternative to v2-memory: one merged memory review per flagged turn (no tools), facts as separate notes, one memory per person at scene end.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true, memory: "lite" },
  "v2-straight": { id: "v2-straight", description: "v2 played straight: no comic house style or consequence flag (the v2 of the deviation experiment).", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000 },
  "v2-comic": { id: "v2-comic", description: "v2 with the comic house style: the world plays it straight, daft acts get real consequences, stakes stay real.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic" },
  "v2-comic-bill": { id: "v2-comic-bill", description: "v2-comic plus consequences: the decider flags daft or reckless acts the world would answer, and the GM follows them through.", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true },
  "v2-pressure": { id: "v2-pressure", description: "The quick-co-GM v2 plus pressure rolls: pressing someone for what they're hiding is ruled yes, no or a roll at DC 12/15/18 (docs/research/dc-guidance.md).", voice: "gm", decider: "luna-decisions", repair: "quick-block", repairKind: "quick", repairDeadlineMs: 3000, tone: "comic", consequences: true, pressureRolls: true },
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

/** The session's approach as a scene runs it: a scene can turn things off or on for itself (a talk has no co-GM). */
export function sceneApproach(state: { approach: string }, scene: { approach?: Partial<Approach> }): Approach {
  return { ...approachById(state.approach), ...scene.approach };
}
