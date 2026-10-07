import type { DoorState, MapFixture, WorldMap } from "../../contracts/src/index.js";
import { canWalk, findPath, pointKey, type Point } from "./navigation.js";

export interface RouteConstraints {
  doors?: readonly DoorState[];
  fixtures?: readonly MapFixture[];
  allowedRoomIds?: readonly string[];
  /** Extra tiles permitted outside the allowed rooms, e.g. a door approach. */
  thresholds?: readonly Point[];
}

export function roomAt(layout: WorldMap, point: Point) {
  return layout.rooms.find(room => room.regions.some(region => point.x >= region.x && point.y >= region.y
    && point.x < region.x + region.width && point.y < region.y + region.height));
}

export function navigationBlockers(doors: readonly DoorState[] = [], fixtures: readonly MapFixture[] = []): Set<string> {
  return new Set([...fixtures.flatMap(item => item.position ? [pointKey(item.position)] : []),
    ...doors.filter(door => !door.open).flatMap(door => door.tiles.map(pointKey))]);
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
