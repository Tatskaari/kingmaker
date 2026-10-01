import { ProficiencyKind, ProficiencyRank, type DndCharacter } from "../../contracts/src/index.js";

export const skillAbilities = {
  athletics: "strength", acrobatics: "dexterity", sleight_of_hand: "dexterity", stealth: "dexterity",
  arcana: "intelligence", history: "intelligence", investigation: "intelligence", nature: "intelligence", religion: "intelligence",
  animal_handling: "wisdom", insight: "wisdom", medicine: "wisdom", perception: "wisdom", survival: "wisdom",
  deception: "charisma", intimidation: "charisma", performance: "charisma", persuasion: "charisma",
} as const;
export type CheckSkill = keyof typeof skillAbilities;
export const degreeGuidance = {
  critical_failure: "Spectacular, entertaining backfire. Fail the attempt, not the entire adventure; leave another opening.",
  major_failure: "The attempt clearly fails with a substantial, playful complication.",
  minor_failure: "The attempt fails with a limited setback or an alternative opening.",
  barely_passes: "Deliver the intended outcome, narrowly or awkwardly. Do not turn this success into another hurdle.",
  minor_success: "Deliver the intended outcome cleanly.",
  major_success: "Deliver the intended outcome plus a meaningful bonus or an exaggerated, delightful effect.",
  critical_success: "Extraordinary success. Make even a gloriously impossible attempt work; embrace absurdity and surprise.",
} as const;
export enum CheckDegree {
  CriticalFailure = "critical_failure",
  MajorFailure = "major_failure",
  MinorFailure = "minor_failure",
  BarelyPasses = "barely_passes",
  MinorSuccess = "minor_success",
  MajorSuccess = "major_success",
  CriticalSuccess = "critical_success",
}
export const degreeLabel = (degree: CheckDegree) => degree.replaceAll("_", " ");

export function resolveDiceCheck(roll: number, dc: number, modifier: number) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new RangeError("A d20 result must be an integer from 1 to 20.");
  const total = roll + modifier, margin = total - dc;
  if (![dc, modifier, total, margin].every(Number.isSafeInteger)) throw new RangeError("Check parameters must be safe integers.");
  const degree = roll === 1 ? CheckDegree.CriticalFailure : roll === 20 ? CheckDegree.CriticalSuccess
    : margin <= -4 ? CheckDegree.MajorFailure : margin < 0 ? CheckDegree.MinorFailure : margin === 0 ? CheckDegree.BarelyPasses
    : margin < 4 ? CheckDegree.MinorSuccess : CheckDegree.MajorSuccess;
  return { total, margin, degree, success: roll !== 1 && (roll === 20 || margin >= 0) };
}

export function skillModifier(build: DndCharacter | undefined, skill: CheckSkill): number {
  const ability = Math.floor(((build?.abilityScores?.[skillAbilities[skill]] ?? 10) - 10) / 2);
  const level = build?.classes.reduce((sum, item) => sum + item.level, 0) ?? 0;
  const proficiency = level > 0 ? 2 + Math.floor((level - 1) / 4) : 0;
  const ranks = build?.proficiencies.filter(item => item.kind === ProficiencyKind.SKILL && item.targetId === skill).map(item => item.rank) ?? [];
  const multiplier = ranks.includes(ProficiencyRank.EXPERTISE) ? 2 : ranks.includes(ProficiencyRank.PROFICIENT) ? 1 : 0;
  return ability + proficiency * multiplier;
}

export function rollD20(): number {
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0]! >= 4294967280);
  return buffer[0]! % 20 + 1;
}
