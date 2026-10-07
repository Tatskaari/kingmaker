import { actorPosition, actorTile } from "../../../packages/core/src/simulation-movement.js";
import { GamePhase, type MapState } from "../../../packages/contracts/src/index.js";
import { createPhysicalEvent } from "./physical-event.js";

export function setPlayerDoor(map: MapState, playerId: string, playerName: string, id: string, open: boolean, atMs = Date.now()) {
  if (map.phase !== GamePhase.CONVERSATIONS) throw new Error("Enter the court before using doors.");
  const door = map.doors.find(door => door.id === id), player = map.actors.find(actor => actor.characterId === playerId);
  const position = actorPosition(player, atMs);
  if (!door || door.open === open || !position || !door.interactionSpots.some(spot => spot.x === position.x && spot.y === position.y)) {
    throw new Error("Walk to a door interaction spot before using it.");
  }
  if (!open && map.actors.some(actor => { const point = actorPosition(actor, atMs); return point && door.tiles.some(tile => tile.x === actorTile(point).x && tile.y === actorTile(point).y); })) {
    throw new Error("Someone is standing in the doorway.");
  }
  door.open = open;
  map.revision++;
  return createPhysicalEvent(map, "using a door", `${playerName} ${open ? "opened" : "closed"} ${door.name}.`, [playerId]);
}
