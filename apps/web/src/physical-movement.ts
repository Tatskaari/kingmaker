import { GamePhase, type MapState } from "../../../packages/contracts/src/index.js";
import { createPhysicalEvent } from "./physical-event.js";

export function setPlayerDoor(map: MapState, playerId: string, playerName: string, id: string, open: boolean) {
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
