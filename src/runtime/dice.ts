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
