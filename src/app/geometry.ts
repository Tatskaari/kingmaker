import type { Tile2 } from "../game/types.ts";
import type { Dir } from "./adapters.ts";

/** Grid helpers shared by the app and its stand-ins. */

export const STEP: Record<Dir, Tile2> = {
  n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 },
  ne: { x: 1, y: -1 }, nw: { x: -1, y: -1 }, se: { x: 1, y: 1 }, sw: { x: -1, y: 1 },
};

export const add = (a: Tile2, b: Tile2): Tile2 => ({ x: a.x + b.x, y: a.y + b.y });
export const same = (a: Tile2, b: Tile2) => a.x === b.x && a.y === b.y;
/** Grid distance where diagonals cost the same as straights (5 ft a square, as the 2024 rules have it). */
export const chebyshev = (a: Tile2, b: Tile2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The direction that best points from one tile towards another. */
export function towards(from: Tile2, to: Tile2): Dir {
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  const entry = (Object.entries(STEP) as Array<[Dir, Tile2]>).find(([, v]) => v.x === dx && v.y === dy);
  return entry?.[0] ?? "s";
}
