import type { DoorState, Room } from "../../contracts/src/index.js";

export type RoomAccess = Pick<Room, "id" | "private" | "allowedCharacterIds">;
/** Illegal actions remain possible; permission describes the act, not a lock. */
export function doorActionLegality(door: Pick<DoorState, "roomIds" | "open">, rooms: readonly RoomAccess[], characterId: string): "normal" | "illegal" {
  if (door.open) return "normal"; // Closing is not entering or opening a private room.
  return rooms.some(room => door.roomIds.includes(room.id) && room.private && !room.allowedCharacterIds.includes(characterId))
    ? "illegal" : "normal";
}
