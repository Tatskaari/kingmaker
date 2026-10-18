// Copied from PR #666's src/runtime/two-part.ts at origin/claude/two-part-gm c749270 (BANDS, BAND_NAME, bandOf, rolesNote and openingRoles' role, whole), for both sides: the simulation rolls a check and picks its outcome by these bands, and writes the co-GM's note for each turn; the AI service reads the same note. The Role is GmState's TwoPartRole; a role's default is a function of the stage (shared/scene/beats.ts stageOf), not the prototype's current beat.
import { describeRoll, type RollResult } from "../dice.ts";
import { stageOf } from "../scene/beats.ts";
import type { Character, Scene } from "../scene/types.ts";
import type { GmState, TwoPartRole } from "./state.ts";

/**
 * The two-part GM's own bookkeeping (docs/two-part-design.md): how a check the mouthpiece called is
 * read (five outcomes, by how far the roll made or missed its DC), each person's conversation role,
 * and the co-GM's note before each player turn that carries them to the mouthpiece.
 */

export const BANDS = ["major_failure", "minor_failure", "barely_passed", "minor_success", "major_success"] as const;
export type Band = typeof BANDS[number];
/** How the dice line says it went, after the roll: "Medicine check: … success (only just)." */
export const BAND_NAME: Record<Band, string> = { major_failure: "badly", minor_failure: "narrowly", barely_passed: "only just", minor_success: "cleanly", major_success: "with room to spare" };

/** How far a roll made or missed it, as one of the five outcomes the mouthpiece wrote. */
export function bandOf(roll: Pick<RollResult, "total" | "dc" | "critical">): Band {
  if (roll.critical === "failure") return "major_failure";
  if (roll.critical === "success") return "major_success";
  const by = roll.total - roll.dc;
  return by <= -5 ? "major_failure" : by < 0 ? "minor_failure" : by <= 2 ? "barely_passed" : by <= 6 ? "minor_success" : "major_success";
}

/**
 * The dice line of a check the mouthpiece called, as the player reads it: the roll against the DC and
 * how far it made or missed it ("Medicine check: 11 + 2 = 13 vs DC 12: success (only just)."). A
 * natural 20 or 1 says so once: describeRoll's mark stands for the band's word.
 */
export function diceLine(roll: RollResult): string {
  return `${describeRoll(roll)}${roll.critical ? "" : ` (${BAND_NAME[bandOf(roll)]})`}.`;
}

/**
 * The co-GM's note before turn `turn + 1` (the opening's is -1's): each person's role as it stands,
 * by name. The mouthpiece reads it as a system message before the player's turn it was written for.
 */
export function rolesNote(scene: Pick<Scene, "cast">, roles: Record<string, TwoPartRole>, turn: number): string {
  return [`Co-GM note, before turn ${turn + 1}`, ...Object.entries(roles).map(([id, r]) => [
    `Character role for ${scene.cast.find(c => c.id === id)?.name ?? id}:`,
    ...(r.status ? [`Status: ${r.status}`] : []), ...(r.mental_state ? [`Mental state: ${r.mental_state}`] : []),
    `Conversation role: ${r.conversation_role}`,
  ].join("\n"))].join("\n\n");
}

/** Someone's role as they come on: the stage's cast note for them (the co-GM's suggestion), else their attitude; no status or mental state yet. */
export function defaultRole(scene: Scene, gm: Pick<GmState, "reached" | "beat">, who: Character): TwoPartRole {
  return { status: "", mental_state: "", conversation_role: stageOf(scene, gm).cast?.[who.id] ?? who.attitude };
}

/** The roles as the scene opens (openingRoles): everyone present, each by defaultRole. */
export function openingRoles(scene: Scene, gm: Pick<GmState, "reached" | "beat">, present: Character[]): Record<string, TwoPartRole> {
  return Object.fromEntries(present.map(c => [c.id, defaultRole(scene, gm, c)]));
}
