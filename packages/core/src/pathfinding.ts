import type { DoorState, MapFixture, WorldMap } from "../../contracts/src/index.js";
import { canWalk, findPath, pointKey, type Point } from "./navigation.js";

export interface RouteConstraints {
  doors?: readonly DoorState[];
  fixtures?: readonly MapFixture[];
  allowedRoomIds?: readonly string[];
  /** Extra tiles permitted outside the allowed rooms, e.g. a door approach. */
  thresholds?: readonly Point[];
}

interface ReachabilityCache { topology: string; regions: Map<string, Map<string, number>> }
const reachabilityByLayout = new WeakMap<WorldMap, ReachabilityCache>();

export function roomAt(layout: WorldMap, point: Point) {
  return layout.rooms.find(room => room.regions.some(region => point.x >= region.x && point.y >= region.y
    && point.x < region.x + region.width && point.y < region.y + region.height));
}

export function navigationBlockers(doors: readonly DoorState[] = [], fixtures: readonly MapFixture[] = []): Set<string> {
  return new Set([...fixtures.flatMap(item => item.position ? [pointKey(item.position)] : []),
    ...doors.filter(door => !door.open).flatMap(door => door.tiles.map(pointKey))]);
}

const topologyKey = (constraints: RouteConstraints) => JSON.stringify({
  doors: (constraints.doors ?? []).map(door => [door.id, door.open, door.tiles.map(pointKey)]).sort(),
  fixtures: (constraints.fixtures ?? []).flatMap(fixture => fixture.position
    ? [[fixture.id, pointKey(fixture.position)]] : []).sort(),
});
const restrictionKey = (constraints: RouteConstraints) => JSON.stringify({
  rooms: [...(constraints.allowedRoomIds ?? [])].sort(),
  thresholds: [...(constraints.thresholds ?? [])].map(pointKey).sort(),
});

/** Label connected walkable regions once per physical topology and room restriction.
 * Actor movement does not invalidate these labels; doors and blocking fixtures do. */
function connectedRegions(layout: WorldMap, constraints: RouteConstraints): Map<string, number> {
  const topology = topologyKey(constraints);
  let cache = reachabilityByLayout.get(layout);
  if (!cache || cache.topology !== topology) {
    cache = { topology, regions: new Map() };
    reachabilityByLayout.set(layout, cache);
  }
  const restriction = restrictionKey(constraints), existing = cache.regions.get(restriction);
  if (existing) return existing;
  const blocked = navigationBlockers(constraints.doors, constraints.fixtures);
  if (constraints.allowedRoomIds) {
    const exceptions = new Set(constraints.thresholds?.map(pointKey));
    for (let index = 0; index < layout.tiles.length; index++) {
      const point = { x: index % layout.width, y: Math.floor(index / layout.width) };
      if (!constraints.allowedRoomIds.includes(roomAt(layout, point)?.id ?? "") && !exceptions.has(pointKey(point))) blocked.add(pointKey(point));
    }
  }
  const regions = new Map<string, number>();
  let region = 0;
  for (let index = 0; index < layout.tiles.length; index++) {
    const start = { x: index % layout.width, y: Math.floor(index / layout.width) }, startKey = pointKey(start);
    if (regions.has(startKey) || !canWalk(layout, start, blocked)) continue;
    region++;
    const queue = [start]; regions.set(startKey, region);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      for (const next of [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: current.x + dx!, y: current.y + dy! }))) {
        const key = pointKey(next);
        if (!regions.has(key) && canWalk(layout, next, blocked)) { regions.set(key, region); queue.push(next); }
      }
    }
  }
  cache.regions.set(restriction, regions);
  return regions;
}

function reachable(layout: WorldMap, from: Point, targets: readonly Point[], constraints: RouteConstraints): boolean {
  const regions = connectedRegions(layout, constraints);
  const fractional = !Number.isInteger(from.x) || !Number.isInteger(from.y);
  const starts = fractional ? Number.isInteger(from.y)
    ? [{ x: Math.floor(from.x), y: from.y }, { x: Math.ceil(from.x), y: from.y }]
    : [{ x: from.x, y: Math.floor(from.y) }, { x: from.x, y: Math.ceil(from.y) }] : [from];
  const startRegions = starts.map(point => regions.get(pointKey(point)));
  if (startRegions.some(value => value === undefined)) return false;
  return targets.some(target => startRegions.includes(regions.get(pointKey(target))));
}

/** Pure route queries over a fixed authored layout. Dynamic obstacles are explicit inputs. */
export function createPathfindingService(layout: WorldMap) {
  const roomTiles = layout.tiles.map((_, index) => {
    const point = { x: index % layout.width, y: Math.floor(index / layout.width) };
    return { key: pointKey(point), roomId: roomAt(layout, point)?.id };
  });
  const blockers = (constraints: RouteConstraints) => {
      const blocked = navigationBlockers(constraints.doors, constraints.fixtures);
      if (constraints.allowedRoomIds) {
        const exceptions = new Set(constraints.thresholds?.map(pointKey));
        for (const tile of roomTiles) {
          if (!constraints.allowedRoomIds.includes(tile.roomId ?? "") && !exceptions.has(tile.key)) blocked.add(tile.key);
        }
      }
      return blocked;
  };
  return {
    isReachable(from: Point, targets: readonly Point[], constraints: RouteConstraints = {}): boolean {
      return reachable(layout, from, targets, constraints);
    },
    findPath(from: Point, to: Point, constraints: RouteConstraints = {}): Point[] | undefined {
      return findPath(layout, from, to, blockers(constraints));
    },
    /** Validate a route already selected by a planner without running A* again. */
    accepts(path: readonly Point[], constraints: RouteConstraints = {}): boolean {
      const blocked = blockers(constraints);
      return path.length > 0 && path.every((point, index) => {
        if (index === 0 && (!Number.isInteger(point.x) || !Number.isInteger(point.y))) {
          return (Number.isInteger(point.x) || Number.isInteger(point.y))
            && canWalk(layout, { x: Math.floor(point.x), y: Math.floor(point.y) }, blocked)
            && canWalk(layout, { x: Math.ceil(point.x), y: Math.ceil(point.y) }, blocked);
        }
        if (!canWalk(layout, point, blocked)) return false;
        const from = path[index - 1];
        return !from || ((from.x === point.x || from.y === point.y)
          && Math.abs(from.x - point.x) + Math.abs(from.y - point.y) > 0
          && Math.abs(from.x - point.x) + Math.abs(from.y - point.y) <= 1);
      });
    },
  };
}
