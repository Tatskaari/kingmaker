import type { DoorState, MapFixture } from "../../../packages/contracts/src/index.js";
import type { Point } from "../../../packages/core/src/navigation.js";
import { createPathfindingService, roomAt } from "../../../packages/core/src/pathfinding.js";
import { palaceMap } from "./palace-map.js";

export { navigationBlockers as courtDoorBlockers } from "../../../packages/core/src/pathfinding.js";
export const courtPathfinding = createPathfindingService(palaceMap);

export const courtRoomAt = (point: Point) => roomAt(palaceMap, point);
export function courtPath(start: Point, end: Point, doors: readonly DoorState[] = [], fixtures: readonly MapFixture[] = []): Point[] | undefined {
  return courtPathfinding.findPath(start, end, { doors, fixtures });
}

export function courtInteractionPoint(start: Point, target: Point, authored?: Point, doors: readonly DoorState[] = [], fixtures: readonly MapFixture[] = []): Point | undefined {
  const candidates = authored ? [authored] : [{ x: target.x, y: target.y + 1 }, { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y }, { x: target.x, y: target.y - 1 }];
  return candidates.map(point => ({ point, path: courtPath(start, point, doors, fixtures) })).filter(candidate => candidate.path)
    .sort((a, b) => a.path!.length - b.path!.length)[0]?.point;
}

export function nearestDoorSpot(start: Point, door: DoorState, doors: readonly DoorState[], fixtures: readonly MapFixture[] = []): Point | undefined {
  return door.interactionSpots.map(point => ({ point, path: courtPath(start, point, doors, fixtures) }))
    .filter(candidate => candidate.path).sort((a, b) => a.path!.length - b.path!.length)[0]?.point;
}

