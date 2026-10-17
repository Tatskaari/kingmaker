// Copied from the prototype's src/runtime/dice.ts at 44c6d4a, whole; added rollFrom (its rollFor's no-sheet path, src/rules/dnd.ts:905-909).

/** Small seeded RNG so eval runs can be reproduced. */
export function rng(seed: number): () => number {
  // splitmix32 scramble: nearby seeds (1000, 1007, ...) must not share their first roll.
  let z = (seed >>> 0) + 0x9e3779b9;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  let state = (z ^ (z >>> 16)) >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

export interface RollResult {
  skill: string;
  dc: number;
  die: number;
  modifier: number;
  total: number;
  success: boolean;
  /** Natural 20 / natural 1 are dramatic regardless of the DC. */
  critical: "success" | "failure" | null;
  advantage?: "advantage" | "disadvantage";
}

export function rollCheck(random: () => number, skill: string, dc: number, modifier: number, advantage?: "advantage" | "disadvantage"): RollResult {
  const d20 = () => 1 + Math.floor(random() * 20);
  let die = d20();
  if (advantage) {
    const second = d20();
    die = advantage === "advantage" ? Math.max(die, second) : Math.min(die, second);
  }
  const total = die + modifier;
  const critical = die === 20 ? "success" : die === 1 ? "failure" : null;
  const success = critical === "success" ? true : critical === "failure" ? false : total >= dc;
  return { skill, dc, die, modifier, total, success, critical, ...(advantage ? { advantage } : {}) };
}

export function describeRoll(roll: RollResult, reason?: string): string {
  const mod = roll.modifier >= 0 ? `+ ${roll.modifier}` : `- ${-roll.modifier}`;
  const crit = roll.critical === "success" ? " (natural 20!)" : roll.critical === "failure" ? " (natural 1!)" : "";
  const why = reason ? ` ${reason.trim().replace(/\.$/, "")}` : "";
  return `${titleCase(roll.skill)} check${why}: ${roll.die} ${mod} = ${roll.total} vs DC ${roll.dc}: ${roll.success ? "success" : "failure"}${crit}`;
}

export const titleCase = (text: string) => text.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/** A game's dice: the seed it was made with, and how many rolls it has made (the simulation's `dice` row). */
export interface Dice { seed: number; rolls: number }

/**
 * A check rolled from a game's dice, as the prototype rolls one without a character sheet: the
 * roll, and the dice after it (one more roll), for the caller to write back in the same
 * transaction. The same dice and the same check always roll the same, so a game replays.
 */
export function rollFrom(dice: Dice, skill: string, dc: number, modifier: number, advantage?: "advantage" | "disadvantage"): { roll: RollResult; dice: Dice } {
  const rolls = dice.rolls + 1;
  const roll = rollCheck(rng(dice.seed + 7919 * rolls), skill, dc, modifier, advantage);
  return { roll, dice: { seed: dice.seed, rolls } };
}
