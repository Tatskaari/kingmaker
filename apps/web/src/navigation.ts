import type { WorldMap } from "../../../packages/contracts/src/index.js";

export interface Point { x: number; y: number }
export interface NavNode extends Point { id: string; name: string }
export interface NavEdge { from: string; to: string }
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

export interface NavRoute { node: NavNode; via: string[]; path: Point[] }
// Dijkstra over the logical graph; each live edge is backed by a real A* tile path.
export function reachableRoutes(map: WorldMap, nodes: readonly NavNode[], edges: readonly NavEdge[], startId: string,
  blocked: ReadonlySet<string> = new Set()): NavRoute[] {
  const start = nodes.find(node => node.id === startId);
  if (!start || !canWalk(map, start, blocked)) return [];
  const routes = new Map<string, NavRoute>([[startId, { node: start, via: [startId], path: [start] }]]);
  const visited = new Set<string>();
  while (true) {
    const current = [...routes.values()].filter(route => !visited.has(route.node.id))
      .sort((a, b) => a.path.length - b.path.length)[0];
    if (!current) break;
    visited.add(current.node.id);
    for (const edge of edges) {
      const id = edge.from === current.node.id ? edge.to : edge.to === current.node.id ? edge.from : undefined;
      if (!id || visited.has(id)) continue;
      const node = nodes.find(candidate => candidate.id === id);
      if (!node) continue;
      const segment = findPath(map, current.node, node, blocked);
      if (!segment) continue;
      const path = [...current.path, ...segment.slice(1)];
      if (path.length < (routes.get(id)?.path.length ?? Infinity)) {
        routes.set(id, { node, path, via: [...current.via, id] });
      }
    }
  }
  return [...routes.values()].filter(route => route.node.id !== startId);
}
