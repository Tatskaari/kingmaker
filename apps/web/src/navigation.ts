import type { WorldMap } from "../../../packages/contracts/src/index.js";

export interface Point { x: number; y: number }
export interface NavNode extends Point { id: string; name: string }
export const pointKey = (point: Point): string => `${point.x},${point.y}`;
const distance = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// Actors occupy one tile. Any intersecting solid layer blocks the entire tile.
export function canWalk(map: WorldMap, point: Point, blocked: ReadonlySet<string>): boolean {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)
    || point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height
    || blocked.has(pointKey(point))) return false;
  const tile = map.tiles[point.y * map.width + point.x];
  return !!tile?.layers.length && !tile.layers.some(layer => layer.solid && (!layer.bounds
    || (layer.bounds.width > 0 && layer.bounds.height > 0 && layer.bounds.x < map.tileWidth
      && layer.bounds.y < map.tileHeight && layer.bounds.x + layer.bounds.width > 0
      && layer.bounds.y + layer.bounds.height > 0)));
}

export function findPath(map: WorldMap, start: Point, goal: Point, blocked: ReadonlySet<string> = new Set()): Point[] | undefined {
  if (!canWalk(map, start, blocked) || !canWalk(map, goal, blocked)) return undefined;
  const open = new Map([[pointKey(start), start]]);
  const costs = new Map([[pointKey(start), 0]]);
  const parents = new Map<string, Point>();
  while (open.size) {
    const current = [...open.values()].reduce((a, b) =>
      costs.get(pointKey(a))! + distance(a, goal) <= costs.get(pointKey(b))! + distance(b, goal) ? a : b);
    const key = pointKey(current);
    if (key === pointKey(goal)) {
      const path = [current];
      let previous = parents.get(key);
      while (previous) { path.unshift(previous); previous = parents.get(pointKey(previous)); }
      return path;
    }
    open.delete(key);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = pointKey(next);
      const cost = costs.get(key)! + 1;
      if (!canWalk(map, next, blocked) || cost >= (costs.get(nextKey) ?? Infinity)) continue;
      costs.set(nextKey, cost); parents.set(nextKey, current); open.set(nextKey, next);
    }
  }
  return undefined;
}
