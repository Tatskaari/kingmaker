// Copied from the prototype's src/game/combat/grid.ts at bc2ab1f, whole: the fight's tile geometry (paths, lines, areas, ranges), which the simulation plays by and a client can highlight by. Its types from ../map/types.ts.
import type { Tile, TileMap, Tile2 } from "../map/types.ts";

/**
 * The tile grid for fights: 5 ft tiles, eight-way movement (a diagonal step costs 5 ft, as in the
 * 2024 rules), paths around walls and people, lines of sight, and spell areas laid on tiles.
 * Pure functions over a TileMap: the map module draws the same map, so a fight and the town agree
 * on where the walls are.
 */

export const FEET = 5;

export const key = (t: Tile2) => `${t.x},${t.y}`;
export const fromKey = (k: string): Tile2 => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; };
export const same = (a: Tile2, b: Tile2) => a.x === b.x && a.y === b.y;
/** Distance in tiles: diagonals count as one step. */
export const steps = (a: Tile2, b: Tile2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const feetBetween = (a: Tile2, b: Tile2) => steps(a, b) * FEET;
export const toFeet = (t: Tile2) => ({ x: t.x * FEET, y: t.y * FEET });
export const fromFeet = (p: { x: number; y: number }): Tile2 => ({ x: Math.round(p.x / FEET), y: Math.round(p.y / FEET) });

export function inBounds(map: TileMap, t: Tile2): boolean {
  return t.x >= 0 && t.y >= 0 && t.x < map.width && t.y < map.height;
}

export function tileAt(map: TileMap, t: Tile2): Tile | undefined {
  return inBounds(map, t) ? map.tiles[t.y]?.[t.x] : undefined;
}

/** Walls, deep water, stacked sacks: nobody stands there. */
export function solid(map: TileMap, t: Tile2): boolean {
  const tile = tileAt(map, t);
  return !tile || tile.blocks === true || tile.terrain === "wall" || tile.terrain === "void" || tile.terrain === "deep-water";
}

export function opaque(map: TileMap, t: Tile2): boolean {
  const tile = tileAt(map, t);
  return !tile || tile.opaque === true || tile.terrain === "wall";
}

const DIRS: Tile2[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }];

export function neighbours(map: TileMap, t: Tile2): Tile2[] {
  return DIRS.map(d => ({ x: t.x + d.x, y: t.y + d.y })).filter(n => inBounds(map, n));
}

export interface PathRules {
  /** Tiles nobody may enter (walls are always out): enemies' spaces. */
  blocked?: (t: Tile2) => boolean;
  /** Tiles you may pass through but not stop on: friends' spaces. */
  noStop?: (t: Tile2) => boolean;
  /** Extra cost to make a path avoid a tile (fire, the dust) without forbidding it. */
  penalty?: (t: Tile2) => number;
  /** How far, in steps (no limit when omitted). */
  maxSteps?: number;
}

/** Can you step diagonally from a to b? Not by squeezing between two walls. */
function cornerFree(map: TileMap, a: Tile2, b: Tile2, rules: PathRules): boolean {
  if (a.x === b.x || a.y === b.y) return true;
  const sideA = { x: b.x, y: a.y }, sideB = { x: a.x, y: b.y };
  const shut = (t: Tile2) => solid(map, t) || rules.blocked?.(t) === true;
  return !(shut(sideA) && shut(sideB));
}

interface Reached { steps: number; cost: number; prev?: string }

/** Every tile reachable from `from` (Dijkstra on steps plus penalties). */
export function explore(map: TileMap, from: Tile2, rules: PathRules = {}): Map<string, Reached> {
  const seen = new Map<string, Reached>([[key(from), { steps: 0, cost: 0 }]]);
  const queue: Array<{ t: Tile2; cost: number }> = [{ t: from, cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { t } = queue.shift()!;
    const here = seen.get(key(t))!;
    if (rules.maxSteps !== undefined && here.steps >= rules.maxSteps) continue;
    for (const n of neighbours(map, t)) {
      if (solid(map, n) || rules.blocked?.(n) || !cornerFree(map, t, n, rules)) continue;
      const cost = here.cost + 1 + (rules.penalty?.(n) ?? 0);
      const k = key(n);
      const known = seen.get(k);
      if (known && known.cost <= cost) continue;
      seen.set(k, { steps: here.steps + 1, cost, prev: key(t) });
      queue.push({ t: n, cost });
    }
  }
  return seen;
}

function unwind(seen: Map<string, Reached>, to: string): Tile2[] {
  const path: Tile2[] = [];
  for (let k: string | undefined = to; k && seen.get(k)?.prev !== undefined; k = seen.get(k)!.prev) path.unshift(fromKey(k));
  return path;
}

/** The cheapest path to a tile (not including the start), or undefined when there's none. */
export function findPath(map: TileMap, from: Tile2, to: Tile2, rules: PathRules = {}): Tile2[] | undefined {
  if (same(from, to)) return [];
  const seen = explore(map, from, { ...rules, maxSteps: undefined });
  if (!seen.has(key(to))) return undefined;
  return unwind(seen, key(to));
}

/** Tiles you can end a move on within `maxSteps`, with the path to each. */
export function destinations(map: TileMap, from: Tile2, maxSteps: number, rules: PathRules = {}): Array<{ at: Tile2; path: Tile2[] }> {
  const seen = explore(map, from, { ...rules, maxSteps });
  return [...seen.keys()].filter(k => k !== key(from) && !rules.noStop?.(fromKey(k))).map(k => ({ at: fromKey(k), path: unwind(seen, k) }));
}

/**
 * The best tile from which to do something (stand next to someone, get a clear shot): the reachable
 * tile that satisfies `good`, cheapest first; or the reachable tile closest to `towards`.
 */
export function approach(map: TileMap, from: Tile2, good: (t: Tile2) => boolean, towards: Tile2, rules: PathRules = {}): { at: Tile2; path: Tile2[]; arrived: boolean } | undefined {
  const seen = explore(map, from, { ...rules, maxSteps: undefined });
  const stoppable = [...seen.entries()].filter(([k]) => k === key(from) || !rules.noStop?.(fromKey(k)));
  const goals = stoppable.filter(([k]) => good(fromKey(k))).sort((a, b) => a[1].cost - b[1].cost);
  if (goals[0]) return { at: fromKey(goals[0][0]), path: unwind(seen, goals[0][0]), arrived: true };
  const near = stoppable.sort((a, b) => steps(fromKey(a[0]), towards) - steps(fromKey(b[0]), towards) || a[1].cost - b[1].cost)[0];
  return near ? { at: fromKey(near[0]), path: unwind(seen, near[0]), arrived: false } : undefined;
}

/** The tiles a straight line crosses, from a to b inclusive (Bresenham). */
export function line(a: Tile2, b: Tile2): Tile2[] {
  const out: Tile2[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 500; guard++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** Nothing opaque between two tiles (the ends themselves don't count). */
export function clearLine(map: TileMap, a: Tile2, b: Tile2): boolean {
  return line(a, b).slice(1, -1).every(t => !opaque(map, t));
}

/** Can a spell or a missile pass from a to b: nothing solid in the way. */
export function clearShot(map: TileMap, a: Tile2, b: Tile2): boolean {
  return line(a, b).slice(1, -1).every(t => !solid(map, t) && !opaque(map, t));
}

export type Shape = "sphere" | "cylinder" | "cube" | "cone" | "line" | "emanation";

/**
 * The tiles a spell's area covers. Spheres and cylinders centre on the aimed tile (radius `size`);
 * a cube cast from the caster sits in front of them towards the aim, otherwise it centres on the
 * aim; cones and lines start at the caster. Tiles the blast can't reach from its origin (behind a
 * wall) are left out.
 */
export function areaTiles(map: TileMap, shape: string, size: number, caster: Tile2, aim: Tile2, fromCaster: boolean): Tile2[] {
  const out: Tile2[] = [];
  const dir = { x: aim.x - caster.x, y: aim.y - caster.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const unit = { x: dir.x / len, y: dir.y / len };
  const sizeTiles = size / FEET;
  // A cube from the caster: the square in front of them, its near edge next to them.
  const half = sizeTiles / 2;
  const cubeCentre = fromCaster ? { x: caster.x + unit.x * (half + 0.5), y: caster.y + unit.y * (half + 0.5) } : aim;
  const origin = shape === "cone" || shape === "line" || (shape === "cube" && fromCaster) ? caster : aim;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = { x, y };
    if (solid(map, t) && tileAt(map, t)?.terrain === "wall") continue;
    const v = { x: x - caster.x, y: y - caster.y };
    const along = v.x * unit.x + v.y * unit.y;
    const across = Math.abs(v.x * unit.y - v.y * unit.x);
    let inside = false;
    switch (shape) {
      case "sphere": case "cylinder": case "emanation": inside = Math.hypot(x - aim.x, y - aim.y) <= sizeTiles + 0.25; break;
      case "cube": inside = Math.abs(x - cubeCentre.x) <= half && Math.abs(y - cubeCentre.y) <= half && !(fromCaster && same(t, caster)); break;
      case "cone": inside = along > 0.5 && along <= sizeTiles + 0.25 && across <= along / 2 + 0.5; break;
      case "line": inside = along > 0.5 && along <= sizeTiles + 0.25 && across <= 0.5; break;
      default: inside = Math.hypot(x - aim.x, y - aim.y) <= sizeTiles + 0.25;
    }
    if (inside && (same(t, origin) || clearShot(map, origin, t))) out.push(t);
  }
  return out;
}

/** "120 feet" → 120, "Touch" → 5, "Self" or "Self (15-foot cone)" → 0. */
export function rangeFeet(range: string): number {
  if (/^touch/i.test(range)) return 5;
  if (/^self/i.test(range)) return 0;
  const m = /(\d+)\s*(feet|foot|ft)/i.exec(range);
  if (m) return Number(m[1]);
  const miles = /(\d+)\s*mile/i.exec(range);
  return miles ? Number(miles[1]) * 5280 : 0;
}
