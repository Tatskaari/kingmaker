import type { ActorMovement, MapState } from "../../contracts/src/index.js";
import { actorTile, pathDistance } from "./simulation-movement.js";
import { roomAt } from "./pathfinding.js";
import type { Point } from "./navigation.js";

export interface RoomDeparture {
  id: string; actorId: string; fromRoomId: string; toRoomId: string;
  doorId?: string; position: Point; atMs: number;
}
/** Crossings of the accepted route, timed at the boundary between tile centres. */
export function roomDepartures(map: MapState, actorId: string, movement: ActorMovement): RoomDeparture[] {
  if (!map.layout) return [];
  const distance = pathDistance(movement.path);
  if (!distance) return [];
  const events: RoomDeparture[] = [];
  let travelled = 0;
  for (let i = 1; i < movement.path.length; i++) {
    const before = movement.path[i - 1]!, after = movement.path[i]!;
    travelled += Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    const from = roomAt(map.layout, actorTile(before)), to = roomAt(map.layout, actorTile(after));
    if (!from || !to || from.id === to.id) continue;
    const door = map.doors.find(door => door.roomIds.includes(from.id) && door.roomIds.includes(to.id)
      && door.tiles.some(tile => [before, after].some(point => point.x === tile.x && point.y === tile.y)));
    events.push({ id: `${movement.id}:exit:${i}`, actorId, fromRoomId: from.id, toRoomId: to.id,
      ...(door ? { doorId: door.id } : {}), position: actorTile(before),
      atMs: movement.startedAtMs + Math.max(0, travelled - 0.5) / distance * movement.durationMs });
  }
  return events;
}
