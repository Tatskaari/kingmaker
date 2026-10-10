import { PalaceMechanics, type MechanicalActivity } from "../../../apps/web/src/palace-mechanics.js";
import { roomAgentActions } from "../../../apps/web/src/room-actions.js";
import { characterDocuments } from "../../lore/src/character-id.js";
import { inventoryOwners } from "../../core/src/inventory.js";
import { worldForCharacter } from "../../core/src/physical-view.js";
import { startMove, completeMove, movementActor } from "../../core/src/simulation-movement.js";
import { recordCharacterHistory } from "../../core/src/character-history.js";
import type { MechanicsStateService } from "../../lore/src/services.js";
import type { RuntimeServices } from "../../conversation/src/services.js";
import type { MapService } from "../../conversation/src/map.js";

/** Headless host: same action routes/rules, with movement time advanced to arrival. */
export function plannerMap(services: RuntimeServices, mechanics: MechanicsStateService): MapService {
  const activity: MechanicalActivity = { conversations: {}, npcActivities: {} };
  let now = 0;
  const game = () => new PalaceMechanics(services.scenario.read(), activity, () => now, {
    currentSimulation: () => services.scenario.read().simulation!, executeMove: mechanics.executeMove,
  });
  return {
    layout: () => services.scenario.read().simulation!.map!.layout!,
    observe(id, selectedActionId) {
      const world = services.scenario.read(), map = world.simulation!.map!;
      const characters = characterDocuments(world).map(({ id, document, character }) => ({ id,
        name: String(document.frontmatter?.name ?? id), inventory: character.inventory }));
      const owners = inventoryOwners(characters, map);
      return { characterId: id, map: worldForCharacter(map, owners, id),
        actions: roomAgentActions(map, characters, owners, id, selectedActionId),
        recentHistory: activity.characterHistory?.[id] ?? [] };
    },
    interact(command, signal) {
      signal?.throwIfAborted();
      if (command.kind !== "step") throw new Error("Planner eval requires an NPC step");
      const { characterId: id, actionId, goal } = command;
      activity.npcActivities![id] = { status: "active", goal, history: [] };
      const { action, actorId, roomId } = game().prepareNpcAction(id, actionId, goal);
      if (action.path.length > 1) {
        const map = services.scenario.read().simulation!.map!;
        const door = action.type === "door" ? map.doors.find(door => door.id === action.target) : undefined;
        const movementId = crypto.randomUUID();
        mechanics.executeMove(startMove, actorId, { id: movementId, path: action.path, to: action.path.at(-1)!,
          startedAtMs: now, msPerTile: 100, allowedRoomIds: action.type === "move" ? [roomId, action.target] : [roomId],
          ...(door ? { thresholds: [...door.tiles, ...door.interactionSpots] } : {}) });
        const movement = movementActor(services.scenario.read().simulation!, actorId)?.movement;
        if (movement?.id !== movementId) throw new Error("Movement did not start");
        now += movement.durationMs;
        mechanics.executeMove(completeMove, actorId, movementId, now);
      }
      signal?.throwIfAborted();
      const result = game().stepNpcAction(id, actionId, goal);
      if (result.talkTarget) recordCharacterHistory(activity, id, { kind: "action", id: actionId, text: action.description });
      return result;
    },
  };
}
