import type { EvalCase } from "../types.ts";

/**
 * Brother Ambrose's game (the user's report of 2026-10-15: a rogue with Insight +6 and Persuasion +0,
 * who felt his good plans were shot down): the Heron's pacing cues, from the game's own snapshots
 * (evals/fixtures/ambrose/, trimmed of the rules engine and the world). The Master came in at 0.57
 * against 0.43 one exchange after he got inside, with no bar and nothing counting the five exchanges
 * the cue asks for; once the Master had been there eight exchanges, the cast-off read only 0.40.
 */
export const ambroseCases: EvalCase[] = [
  { kind: "decision", id: "amb-dec-master-not-yet", about: "One exchange after he got inside (the cue asks for five), blending in and waiting for his inside man isn't lying low: the Master doesn't come yet.", scene: "heron-warehouse", setup: { snapshot: "evals/fixtures/ambrose/heron-078.json" }, phase: "before",
    input: "(I do as I'm told and make no immediate move to talk to hobb. Once they stop watching to eagerly I casually move closer and wait for him to give me the scoop)", expect: ["none"], tags: ["cues"] },
  { kind: "decision", id: "amb-dec-cast-off-counted", about: "Eight exchanges since the Master came (the cue asks for six), and he's waiting for the count to finish: the second bell, and the barge's casting off is held for his answer.", scene: "heron-warehouse", setup: { snapshot: "evals/fixtures/ambrose/heron-087.json" }, phase: "before",
    input: "(I guess I go back to work and wait for them to finish the count. I keep listening for details until Kell and I can arrest him)", expect: ["cast-off"], tags: ["cues"] },
];
