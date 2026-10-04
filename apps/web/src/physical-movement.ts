import { create } from "@bufbuild/protobuf";
import { GamePhase, TilePositionSchema, type WorldState } from "../../../packages/contracts/src/index.js";
import { courtPath, courtRoomAt } from "./court-map.js";
import { createPhysicalEvent } from "./physical-event.js";
import type { Point } from "./navigation.js";

/** Apply validated player movement to a detached map. */
export function movePlayer(map: WorldState, playerId: string, destination: Point): void {
  if (map.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter the court before walking around.");
  const actor = map.actors.find(actor => actor.characterId === playerId);
  if (!actor) throw new Error("Player is missing from the palace.");
  if (!actor.position || !courtPath(actor.position, destination, map.doors, map.fixtures)) throw new Error("That destination is not reachable.");
  const room = courtRoomAt(destination);
  if (!room) throw new Error("That destination is outside the palace.");
  if (!map.rooms.some(existing => existing.id === room.id)) throw new Error("Destination room is missing from the authored world.");
  actor.roomId = room.id;
  actor.position = create(TilePositionSchema, destination);
  map.revision++;
}

export function setPlayerDoor(map: WorldState, playerId: string, playerName: string, id: string, open: boolean) {
  if (map.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter the court before using doors.");
  const door = map.doors.find(door => door.id === id), player = map.actors.find(actor => actor.characterId === playerId);
  if (!door || door.open === open || !player?.position || !door.interactionSpots.some(spot => spot.x === player.position!.x && spot.y === player.position!.y)) {
    throw new Error("Walk to a door interaction spot before using it.");
  }
  if (!open && map.actors.some(actor => actor.position && door.tiles.some(tile => tile.x === actor.position!.x && tile.y === actor.position!.y))) {
    throw new Error("Someone is standing in the doorway.");
  }
  door.open = open;
  map.revision++;
  return createPhysicalEvent(map, "using a door", `${playerName} ${open ? "opened" : "closed"} ${door.name}.`, [playerId]);
}
