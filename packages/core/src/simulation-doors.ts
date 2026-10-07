import { INVALID_MOVE } from "boardgame.io/core";
import { GamePhase } from "../../contracts/src/index.js";
import type { SimulationState } from "../../contracts/src/v2.js";
import type { SimulationMoveContext } from "./simulation-move.js";
import { actorPosition, actorTile, movementActor } from "./simulation-movement.js";

export function doorError(G: SimulationState, actorId: string, doorId: string, open: boolean, atMs: number): string | undefined {
  const map = G.map;
  if (!map || map.phase !== GamePhase.CONVERSATIONS) return "Enter the court before using doors.";
  const door = map.doors.find(door => door.id === doorId);
  const position = actorPosition(movementActor(G, actorId), atMs);
  if (!Number.isFinite(atMs) || typeof open !== "boolean" || !door || door.open === open || !position
    || !door.interactionSpots.some(spot => spot.x === position.x && spot.y === position.y)) {
    return "Walk to a door interaction spot before using it.";
  }
  if (!open && map.actors.some(actor => {
    const point = actorPosition(actor, atMs);
    return point && door.tiles.some(tile => tile.x === actorTile(point).x && tile.y === actorTile(point).y);
  })) return "Someone is standing in the doorway.";
}

/** Time is supplied by the authority; clients may run the same deterministic rule. */
export function setDoor({ G }: SimulationMoveContext, actorId: string, doorId: string, open: boolean, atMs: number) {
  if (doorError(G, actorId, doorId, open, atMs)) return INVALID_MOVE;
  G.map!.doors.find(door => door.id === doorId)!.open = open;
  G.map!.revision++;
}
