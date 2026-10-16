// V0's campaigns/caerwyn/builds.json (claude/v2-v0 at 97053a5), the three ready-made characters as the prototype's engine dumped them: moved here when V1's builds.json became { concept, build } (v1-design §3.9).
import type { Skill } from "../../../shared/scene/types.ts";
import type { GearRow } from "../../../shared/rules/types.ts";

/**
 * A bridge, until newGame makes the ready-made character through the rules engine (v1-design §3.6,
 * package B, which deletes this file): V0's sheets for its three ready-made builds, so newGame plays
 * as it did in V0. builds.json's other two (cleric, fighter) have no sheet here, and refuse not_built.
 */

export interface ReadyMade {
  /** The build line: "elf ranger 3 (Hunter), soldier background". */
  build: string;
  level: number;
  /** Every skill's modifier, all 18. */
  skills: Record<Skill, number>;
  /** "HP 28/28, spell slots 1st 3/3" */
  status: string;
  /** The kit, by the engine's item definition ("longbow"). */
  gear: GearRow[];
}

export const READY_MADE: Record<string, ReadyMade> = {
  ranger: {
    build: "elf ranger 3 (Hunter), soldier background", level: 3, status: "HP 28/28, spell slots 1st 3/3",
    skills: { persuasion: -1, deception: -1, intimidation: 1, insight: 2, performance: -1, perception: 4, investigation: 0, sleight_of_hand: 3, stealth: 5, athletics: 3, acrobatics: 3, animal_handling: 2, arcana: 0, history: 0, nature: 0, religion: 0, medicine: 2, survival: 6 },
    gear: [{ id: "longbow", name: "Longbow", kind: "weapon", slot: "mainHand" }, { id: "shortsword", name: "Shortsword", kind: "weapon" }, { id: "studded-leather", name: "Studded Leather", kind: "armor", slot: "armor" }],
  },
  rogue: {
    build: "halfling rogue 3 (Thief), criminal background", level: 3, status: "HP 24/24",
    skills: { persuasion: 0, deception: 0, intimidation: 0, insight: 5, performance: 0, perception: 3, investigation: 5, sleight_of_hand: 5, stealth: 5, athletics: -1, acrobatics: 5, animal_handling: 1, arcana: 1, history: 1, nature: 1, religion: 1, medicine: 1, survival: 1 },
    gear: [{ id: "rapier", name: "Rapier", kind: "weapon", slot: "mainHand" }, { id: "shortbow", name: "Shortbow", kind: "weapon" }, { id: "dagger", name: "Dagger", kind: "weapon" }, { id: "leather-armor", name: "Leather Armor", kind: "armor", slot: "armor" }],
  },
  wizard: {
    build: "human wizard 3 (Evoker), sage background", level: 3, status: "HP 20/20, spell slots 1st 4/4, 2nd 2/2",
    skills: { persuasion: 0, deception: 0, intimidation: 0, insight: 1, performance: 0, perception: 1, investigation: 5, sleight_of_hand: 2, stealth: 2, athletics: -1, acrobatics: 2, animal_handling: 1, arcana: 5, history: 5, nature: 3, religion: 3, medicine: 3, survival: 1 },
    gear: [{ id: "quarterstaff", name: "Quarterstaff", kind: "weapon", slot: "mainHand" }, { id: "dagger", name: "Dagger", kind: "weapon" }],
  },
};
