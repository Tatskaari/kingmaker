import type { Scenario } from "../../../packages/contracts/src/index.js";
import type { courtAgentObservation, CourtAgentAction } from "./court-agent.js";

/** The engine retains paths and generations; Jev sees entities and their actions. */
export function jevRoomWorld(scenario: Scenario, observation: ReturnType<typeof courtAgentObservation>) {
  const world = scenario.world!, roomId = observation.world.location.roomId;
  const room = world.rooms.find(item => item.id === roomId)!;
  const summarize = (action: CourtAgentAction) => ({ id: action.id, description: action.description,
    ...(action.legality === "illegal" ? { illegal: true } : {}) });
  const actionsFor = (target: string) => observation.actions.filter(action => action.target === target).map(summarize);
  return {
    rooms: world.rooms.map(({ id, name, exitRoomIds }) => ({ id, name, exits: exitRoomIds })),
    currentRoom: {
      id: room.id, name: room.name,
      characters: observation.world.nearbyCharacters.filter(item => item.characterId !== observation.characterContext.character.id)
        .map(({ characterId }) => ({ id: characterId, name: scenario.characters.find(item => item.id === characterId)?.name,
          actions: actionsFor(characterId) })),
      furniture: observation.world.furniture.map(item => ({ ...item, actions: actionsFor(item.id) })),
      doors: world.doors.filter(door => door.roomIds.includes(roomId)).map(door => ({
        id: door.id, name: door.name, connects: door.roomIds, open: door.open, actions: actionsFor(door.id),
      })),
      exits: room.exitRoomIds.map(id => ({ roomId: id, actions: actionsFor(id),
        ...(!observation.actions.some(action => action.type === "move" && action.target === id)
          ? { blocked: "No reachable route. A connecting door may need opening first." } : {}) })),
    },
    inventory: observation.world.inventory.map(item => ({ ...item,
      actions: observation.actions.filter(action => action.id === `inspect_item_${item.id}`).map(summarize) })),
  };
}
