import type { PhysicalCharacterObservation } from "./physical-observation.js";
import type { WorldState } from "../../../packages/contracts/src/index.js";
import type { GameAction as CourtAgentAction } from "../../../packages/core/src/actions.js";
const steps = (count: number) => `${count} ${count === 1 ? "step" : "steps"}`;

/** This text is the world interface sent to Jev, not a separate debug summary. */
export function renderJevRoomView(world: WorldState, characters: readonly { id: string; name: string }[], observation: PhysicalCharacterObservation): string {
  const roomId = observation.world.location.roomId;
  const room = world.rooms.find(item => item.id === roomId)!;
  const nameOfRoom = (id: string) => world.rooms.find(item => item.id === id)?.name ?? id;
  const actionsFor = (target: string) => observation.actions.filter(action => action.target === target);
  const renderActions = (actions: CourtAgentAction[], name: string, distance?: number) => actions.map(action => {
    let label = action.description.replace(/ \(\d+ steps\)\.$/, "");
    if (label.endsWith(` ${name}`)) label = label.slice(0, -name.length - 1);
    return `    - ${label}${action.legality === "illegal" ? " (illegal)" : ""}`
      + (distance === action.path.length - 1 ? "" : ` — ${steps(action.path.length - 1)}`) + ` [${action.id}]`;
  });
  const entities = [
    ...observation.world.nearbyCharacters.filter(item => item.characterId !== observation.characterId)
      .map(({ characterId }) => ({ id: characterId, name: characters.find(item => item.id === characterId)?.name ?? characterId, details: [] as string[] })),
    ...observation.world.furniture.map(item => ({ id: item.id, name: item.name, details:
      world.fixtures.find(fixture => fixture.id === item.id)?.container ? [
        `State: ${item.open ? "open" : item.requiredKeyId ? "locked" : "closed"}`,
        `Contents: ${typeof item.contents === "string" ? item.contents : item.contents?.map(content => content.name).join(", ") || "empty"}`,
      ] : [] })),
  ].map(entity => ({ ...entity, actions: actionsFor(entity.id) }))
    .sort((a, b) => Math.min(...a.actions.map(action => action.path.length)) - Math.min(...b.actions.map(action => action.path.length)) || a.id.localeCompare(b.id));
  const lines = [`${room.name} (current room) [${room.id}]:`];
  for (const entity of entities) {
    const distance = Math.min(...entity.actions.map(action => action.path.length - 1));
    lines.push(`  ${Number.isFinite(distance) ? distance === 0 ? "Within reach" : steps(distance) + " away" : "No available actions"}: ${entity.name} [${entity.id}]`,
      ...entity.details.map(detail => `    ${detail}`), ...renderActions(entity.actions, entity.name, distance));
  }
  if (!entities.length) lines.push("  No other characters or furniture.");
  lines.push("", "Exits:");
  for (const id of room.exitRoomIds) {
    lines.push(`  ${nameOfRoom(id)} [${id}]:`);
    for (const door of world.doors.filter(door => door.roomIds.includes(roomId) && door.roomIds.includes(id))) {
      lines.push(`    ${door.name}: ${door.open ? "open" : "closed"}`, ...renderActions(actionsFor(door.id), ""));
    }
    const travel = actionsFor(id);
    lines.push(...(travel.length ? renderActions(travel, "") : ["    Entry blocked: no reachable route; a connecting door may need opening first."]));
  }
  lines.push("", "Inventory:");
  for (const item of observation.world.inventory) lines.push(`  ${item.name} [${item.id}]`,
    ...renderActions(observation.actions.filter(action => action.id === `inspect_item_${item.id}`), item.name, 0));
  if (!observation.world.inventory.length) lines.push("  Empty.");
  lines.push("", "Room connections (map, not live observations):");
  for (const item of world.rooms) lines.push(`  ${item.name} → ${item.exitRoomIds.map(nameOfRoom).join(", ") || "No exits"}`);
  return lines.join("\n");
}
