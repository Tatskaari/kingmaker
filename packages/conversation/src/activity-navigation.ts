import type { WorldState } from "../../contracts/src/v2.js";

/** Room-level guidance uses the same exits and enter_<room> actions as the planner.
 * Doors are assumed open; the executor still handles doors and physical blockers.
 * Deliberately exposes all on-map NPC locations to activity review for now. */
export function activityNpcLocations(world: WorldState, characterId: string): string {
  const map = world.simulation?.map;
  if (!map) return "NPC locations unavailable: no current map.";
  const id = (actor: (typeof map.actors)[number]) => actor.instanceId || actor.characterId;
  const origin = map.actors.find(actor => id(actor) === characterId);
  const rooms = new Map(map.rooms.map(room => [room.id, room]));
  const routes = new Map<string, string[]>();
  if (origin && rooms.has(origin.roomId)) routes.set(origin.roomId, []);
  // Breadth-first traversal gives the fewest room entries, ignoring door state.
  for (const [roomId, route] of routes) {
    for (const next of rooms.get(roomId)!.exitRoomIds) {
      if (rooms.has(next) && !routes.has(next)) routes.set(next, [...route, `enter_${next}`]);
    }
  }
  return map.actors.filter(actor => id(actor) !== characterId && actor.characterId !== "player").map(actor => {
    const actorId = id(actor), room = rooms.get(actor.roomId), route = routes.get(actor.roomId);
    const entry = world.simulation!.runtimeCharacters[actorId]?.document;
    const name = entry ? world.docs[entry]?.frontmatter?.name : undefined;
    const guidance = !room ? "location unavailable" : !origin || !rooms.has(origin.roomId) ? "route unavailable: origin unknown"
      : !route ? "no connected room route" : route.length ? `walk via ${route.join(", ")}` : "already in your room";
    return `- ${typeof name === "string" ? name : actorId} (${actorId}): ${room?.name ?? "Unknown room"} (${guidance})`;
  }).join("\n") || "No other NPCs on the current map.";
}
