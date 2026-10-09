import { actorTile } from "../../../packages/core/src/simulation-movement.js";
import { itemsFor, type InventoryOwner } from "../../../packages/core/src/inventory.js";
import type { MapState } from "../../../packages/contracts/src/index.js";
import { doorActionLegality } from "../../../packages/core/src/access.js";
import { fixtureActions } from "../../../packages/core/src/fixtures.js";
import type { GameAction as CourtAgentAction } from "../../../packages/core/src/actions.js";
import { createPathfindingService, roomAt } from "../../../packages/core/src/pathfinding.js";
import { palaceNodes } from "./palace-navigation.js";
import { pointKey, type Point } from "../../../packages/core/src/navigation.js";

const neighbours = (point: Point): Point[] => [
  { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y },
  { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 },
];

/** Discovery assumes authored local targets are reachable and leaves paths empty.
 * Supplying an action ID plans only that selected action.
 * Room-scoped routes cannot take shortcuts through a third room. Door approaches
 * may occupy the adjoining room's threshold in the authored map. */
export function roomAgentActions(world: MapState, characters: readonly { id: string; name: string }[], owners: readonly InventoryOwner[], characterId: string, continuingActionId?: string): CourtAgentAction[] {
  const routing = continuingActionId ? createPathfindingService(world.layout!) : undefined;
  const actor = world.actors.find(item => item.characterId === characterId)!;
  const start = actor.position!, room = world.rooms.find(item => item.id === actor.roomId)!;
  const estimate = (points: readonly Point[]) => Math.min(...points.map(point => Math.abs(start.x - point.x) + Math.abs(start.y - point.y)));
  const route = (end: Point, allowedRoomIds = [room.id], thresholds: Point[] = []) =>
    routing!.findPath(start, end, { doors: world.doors, fixtures: world.fixtures, allowedRoomIds, thresholds });
  const shortest = (paths: (Point[] | undefined)[]) => paths.filter((path): path is Point[] => !!path)
    .sort((a, b) => a.length - b.length)[0];
  const actions: CourtAgentAction[] = [];
  for (const target of world.rooms) {
    const id = `enter_${target.id}`;
    // Continue a selected crossing to its waypoint after the actor enters the room.
    if (!room.exitRoomIds.includes(target.id) && !(target.id === room.id && continuingActionId === id)) continue;
    if (continuingActionId && id !== continuingActionId) continue;
    const doors = world.doors.filter(door => door.roomIds.includes(room.id) && door.roomIds.includes(target.id));
    if (doors.length && !doors.some(door => door.open)) continue;
    const candidates = palaceNodes.filter(node => roomAt(world.layout!, node)?.id === target.id);
    const path = !routing ? [] : shortest(candidates.map(node => route(node, [room.id, target.id])));
    if (path) actions.push({ id, type: "move", target: target.id, path, estimatedSteps: estimate(candidates),
      legality: target.private && !target.allowedCharacterIds.includes(characterId) ? "illegal" : "normal",
      description: `Enter ${target.name} (${estimate(candidates)} steps).` });
  }
  for (const door of world.doors.filter(item => item.roomIds.includes(room.id))) {
    for (const [side, spot] of door.interactionSpots.entries()) {
      const id = `${door.open ? "close" : "open"}_${door.id}_${side}`;
      if (continuingActionId && id !== continuingActionId) continue;
      if (!routing && door.roomIds[side] !== room.id) continue;
      const path = !routing ? [] : route(spot, [room.id], [...door.interactionSpots, ...door.tiles]);
      // Only this side: crossing an open door is a separate room-navigation choice.
      if (!path || path.slice(1).some(point => door.tiles.some(tile => pointKey(tile) === pointKey(point)))) continue;
      actions.push({ id: `${door.open ? "close" : "open"}_${door.id}_${side}`, type: "door", target: door.id,
        path, estimatedSteps: estimate([spot]), open: !door.open, interactionRoomId: door.roomIds[side] ?? room.id,
        legality: doorActionLegality(door, world.rooms, characterId),
        description: `${door.open ? "Close" : "Open"} ${door.name} (${estimate([spot])} steps).` });
    }
  }
  for (const action of fixtureActions(world.fixtures, owners, characterId)) {
    if (continuingActionId && action.id !== continuingActionId) continue;
    const fixture = world.fixtures.find(item => item.id === action.target);
    if (action.target !== characterId && (!fixture?.position || fixture.roomId !== room.id)) continue;
    if (action.verb === "open" && fixture?.requiredKeyId
      && !itemsFor(owners, characterId).some(item => item.id === fixture.requiredKeyId)) continue;
    const candidates = action.target === characterId ? [start] : fixture!.interactionSpot ? [fixture!.interactionSpot] : neighbours(fixture!.position!);
    const path = !routing ? [] : shortest(candidates.map(point => route(point)));
    if (path) actions.push({ id: action.id, type: "fixture", target: action.target, path, estimatedSteps: estimate(candidates), legality: action.legality,
      description: `${action.label} (${estimate(candidates)} steps).` });
  }
  for (const other of world.actors) {
    if (other.characterId === characterId || other.roomId !== room.id || !other.awake || !other.position) continue;
    for (const verb of ["talk", "follow"] as const) {
      if (continuingActionId && `${verb}_${other.characterId}` !== continuingActionId) continue;
      const target = characters.find(item => item.id === other.characterId);
      const candidates = neighbours(actorTile(other.position));
      const estimatedSteps = estimate(candidates);
      const path = !routing ? [] : shortest(candidates.map(point => route(point)));
      if (target && path) {
        const existing = actions.findIndex(action => action.id === `${verb}_${target.id}`);
        if (existing >= 0 && (routing ? actions[existing]!.path.length <= path.length : actions[existing]!.estimatedSteps! <= estimatedSteps)) continue;
        const action: CourtAgentAction = { id: `${verb}_${target.id}`, type: verb, target: target.id, path, estimatedSteps,
          description: verb === "talk" ? `Talk to ${target.name} (${estimatedSteps} steps).`
            : `Follow ${target.name}: stay on a free adjacent tile as they move; reconsider every 15 seconds (${estimatedSteps} steps).` };
        if (existing >= 0) actions[existing] = action; else actions.push(action);
      }
  }
  }
  return actions;
}
