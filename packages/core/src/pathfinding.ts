import type { DoorState, MapFixture, WorldMap } from "../../contracts/src/index.js";
import { findPath, pointKey, type Point } from "./navigation.js";

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
  return {
    findPath(from: Point, to: Point, constraints: RouteConstraints = {}): Point[] | undefined {
      const blocked = navigationBlockers(constraints.doors, constraints.fixtures);
      if (constraints.allowedRoomIds) {
        const exceptions = new Set(constraints.thresholds?.map(pointKey));
        for (const tile of roomTiles) {
          if (!constraints.allowedRoomIds.includes(tile.roomId ?? "") && !exceptions.has(tile.key)) blocked.add(tile.key);
        }
      }
      return findPath(layout, from, to, blocked);
    },
  };
}
