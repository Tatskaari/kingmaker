import type { SimulationState } from "../../contracts/src/v2.js";
import { actorPosition, actorTile, movementActor } from "./simulation-movement.js";
import { createPathfindingService, roomAt } from "./pathfinding.js";

/** A fresh route to a free tile beside the moving target; never mutates the world. */
export function followRoute(simulation: SimulationState, id: string, targetId: string, atMs: number) {
  const map = simulation.map, actor = movementActor(simulation, id), target = movementActor(simulation, targetId);
  if (!map?.layout || !actor || !target || actor === target || !target.awake) return;
  const from = actorPosition(actor, atMs), position = actorPosition(target, atMs);
  if (!from || !position) return;
  const tile = actorTile(position);
  const allowedRoomIds = map.rooms.filter(room => !room.private || room.allowedCharacterIds.includes(actor.characterId)
    || room.id === actor.roomId).map(room => room.id);
  const routing = createPathfindingService(map.layout);
  const occupied = new Set(map.actors.filter(other => other !== actor).flatMap(other => {
    const point = actorPosition(other, atMs);
    return point ? [`${Math.round(point.x)},${Math.round(point.y)}`] : [];
  }));
  const paths = [{ x: tile.x - 1, y: tile.y }, { x: tile.x + 1, y: tile.y },
    { x: tile.x, y: tile.y - 1 }, { x: tile.x, y: tile.y + 1 }]
    .filter(point => !occupied.has(`${point.x},${point.y}`) && roomAt(map.layout!, point)?.id === roomAt(map.layout!, tile)?.id)
    .flatMap(point => {
      const path = routing.findPath(from, point, { doors: map.doors, fixtures: map.fixtures, allowedRoomIds });
      return path ? [path] : [];
    }).sort((a, b) => a.length - b.length);
  return paths[0] ? { path: paths[0], allowedRoomIds } : undefined;
}
