import { inventoryOwners } from "../../../packages/core/src/inventory.js";
import type { Scenario } from "../../../packages/contracts/src/index.js";
import { characterDecisionContext } from "../../../packages/core/src/context.js";
import { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import { physicalCharacterObservation } from "./physical-observation.js";
import { roomAgentActions } from "./room-actions.js";

export type { GameAction as CourtAgentAction } from "../../../packages/core/src/actions.js";
import type { GameAction as CourtAgentAction } from "../../../packages/core/src/actions.js";

/** Shared room observation for a placed player or NPC. */
export function courtAgentObservation(scenario: Scenario, characterId: string, continuingActionId?: string) {
  if (characterId === scenario.playerCharacterId) throw new Error("NPC observation requires an NPC.");
  return characterCourtObservation(scenario, characterId, continuingActionId);
}

export function characterCourtObservation(scenario: Scenario, characterId: string, continuingActionId?: string) {
  const character = scenario.characters.find(item => item.id === characterId);
  const world = scenario.world, actor = world?.actors.find(item => item.characterId === characterId);
  if (!character || !world || !actor?.position) throw new Error("Character is not placed in the palace.");
  const actions = roomAgentActions(scenario.world!, scenario.characters, inventoryOwners(scenario.characters, scenario.world), characterId, continuingActionId);
  const known = worldForCharacter(world, inventoryOwners(scenario.characters, world), characterId);
  return { ...physicalCharacterObservation(known, characterId, character.currentGoal, actions),
    characterContext: characterDecisionContext(scenario, characterId, character.currentGoal) };
}
