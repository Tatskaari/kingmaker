import { inventoryOwners } from "../../../packages/core/src/inventory.js";
import type { Scenario } from "../../../packages/contracts/src/index.js";
import { characterDecisionContext } from "../../../packages/core/src/context.js";
import { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import { fixtureActions, fixtureName } from "../../../packages/core/src/fixtures.js";
import { roomAgentActions } from "./room-actions.js";

export type { GameAction as CourtAgentAction } from "../../../packages/core/src/actions.js";
import type { GameAction as CourtAgentAction } from "../../../packages/core/src/actions.js";

export function actionResourceIds(scenario: Scenario, characterId: string, action?: CourtAgentAction): string[] {
  const keys = ["world:context", `character:${characterId}`, `actor:${characterId}`, `inventory:${characterId}`,
    ...(scenario.world?.doors.map(door => `door:${door.id}`) ?? [])];
  if (action?.type === "talk") keys.push(`character:${action.target}`, `actor:${action.target}`);
  if (action?.type === "door") keys.push(`doorway:${action.target}`);
  if (action?.type === "fixture") {
    const fixtureAction = fixtureActions(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), characterId).find(item => item.id === action.id);
    if (action.target !== characterId) keys.push(`fixture:${action.target}`, `inventory:${action.target}`);
    if (fixtureAction?.itemId) keys.push(`item:${fixtureAction.itemId}`);
  }
  return [...new Set(keys)];
}

/** Shared room observation for a placed player or NPC. */
export function courtAgentObservation(scenario: Scenario, characterId: string, continuingActionId?: string) {
  if (characterId === scenario.playerCharacterId) throw new Error("NPC observation requires an NPC.");
  return characterCourtObservation(scenario, characterId, continuingActionId);
}

export function characterCourtObservation(scenario: Scenario, characterId: string, continuingActionId?: string) {
  const character = scenario.characters.find(item => item.id === characterId);
  const world = scenario.world, actor = world?.actors.find(item => item.characterId === characterId);
  if (!character || !world || !actor?.position) throw new Error("Character is not placed in the palace.");
  const start = actor.position;
  const actions = roomAgentActions(scenario, characterId, continuingActionId);
  const known = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), characterId);
  return {
    revision: world.revision, goal: character.currentGoal, characterContext: characterDecisionContext(scenario, characterId, character.currentGoal),
    world: {
      location: { roomId: actor.roomId, room: world.rooms.find(room => room.id === actor.roomId)?.name, position: start },
      rooms: world.rooms.map(({ id, name }) => ({ id, name })),
      doors: world.doors.map(({ id, name, roomIds, open }) => ({ id, name, roomIds, open })),
      nearbyCharacters: world.actors.filter(other => other.roomId === actor.roomId).map(({ characterId, position }) => ({ characterId, position })),
      inventory: known.objects.filter(item => item.locationId === characterId).map(({ id, name }) => ({ id, name })),
      furniture: known.fixtures.filter(item => item.roomId === actor.roomId).map(item => ({ id: item.id, name: fixtureName(item, characterId),
        open: item.open, ...(item.requiredKeyId ? { requiredKeyId: item.requiredKeyId } : {}),
        ...(item.open || item.searchedBy.includes(characterId) ? { contents: known.objects.filter(object => object.locationId === item.id).map(({ id, name }) => ({ id, name })) } : { contents: "Unknown until opened" }),
      })),
    },
    actions,
  };
}
