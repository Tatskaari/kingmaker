import type { Tile2 } from "../types.ts";

/**
 * The arena's rings (wings/arena.ts registers them; fights.ts sets their fights up): who fights in
 * each, where, and its way out. The fighters are people in the arena's world, so the fight starts
 * with everyone where the world has them, and the fight's end is written back into it.
 */
export interface Arena {
  id: string;
  /** The wing it's in (its map, and its world's scene id). */
  wing: string;
  name: string;
  /** The ring's floor: its lights, dust and what burns count; outside it doesn't. */
  ring: { x: number; y: number; w: number; h: number };
  /** Where the player starts, inside the ring. */
  start: Tile2;
  /** The ring's way out (a gate): stand in it with movement to spare and press l, and you've fled. */
  gate: Tile2;
  /** Just outside the gate: where a player who fled ends up. */
  outside: Tile2;
  /** The other side: people in the arena's world, by id, with how they fight. */
  enemies: Array<{ id: string; statblock: string; weapon?: string; role: "bruiser" | "villain" | "coward" | "brawler" | "archer"; castId?: string }>;
  /** Sergeant Kell fights beside you (she's in every ring she's asked into; she's in the Heron's always). */
  kell?: boolean;
}

export const ARENAS: Record<string, Arena> = {};

export function registerArena(a: Arena): Arena {
  ARENAS[a.id] = a;
  return a;
}
