/**
 * Each approach is a runnable PoC: the same scenes, different orchestration.
 * - voice "gm": one Luna call per turn; the GM narrates and voices everyone (Friends & Fables style).
 * - voice "actors": a decider picks who speaks; each character is a separate Luna call that only
 *   knows what that character knows; the GM narrates the world between them.
 * - decider: who judges beat transitions, rolls and speakers (Jev decision mode vs Luna structured output).
 * - repair: the co-GM agent reviews the scene between turns and leaves notes and graph patches.
 */
export interface Approach {
  id: string;
  description: string;
  voice: "gm" | "actors";
  decider: string;
  repair: "off" | "background";
  repairEffort?: "low" | "medium" | "high";
}

export const APPROACHES: Record<string, Approach> = {
  gm: { id: "gm", description: "Single GM voice; Jev tracks beats, rolls and exits.", voice: "gm", decider: "jev", repair: "off" },
  "gm-luna": { id: "gm-luna", description: "Single GM voice; Luna (structured output, no reasoning) tracks beats.", voice: "gm", decider: "luna-none", repair: "off" },
  "gm-repair": { id: "gm-repair", description: "Single GM voice plus the background co-GM repair agent.", voice: "gm", decider: "jev", repair: "background" },
  actors: { id: "actors", description: "Jev picks who speaks; each character is its own Luna actor; GM narrates.", voice: "actors", decider: "jev", repair: "off" },
  "actors-repair": { id: "actors-repair", description: "Actors plus the background co-GM repair agent.", voice: "actors", decider: "jev", repair: "background" },
};

export function approachById(id: string): Approach {
  const approach = APPROACHES[id];
  if (!approach) throw new Error(`Unknown approach ${id}. Known: ${Object.keys(APPROACHES).join(", ")}`);
  return approach;
}
