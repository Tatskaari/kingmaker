import type { Scenario } from "../../../packages/contracts/src/index.js";
import { locatedItems } from "../../../packages/core/src/inventory.js";
import { renderWorldPrompt } from "../../../packages/core/src/world-prompt.js";

/** Preload exact versions only for participants and their immediate surroundings.
 * Other resources remain available through read_state; never project a write payload. */
export function initialModelResourceIds(scenario: Scenario, participants: readonly string[]): string[] {
  const characters = new Set([...participants, ...(scenario.playerCharacterId ? [scenario.playerCharacterId] : [])]);
  const rooms = new Set(scenario.world?.actors.filter(actor => characters.has(actor.characterId)).map(actor => actor.roomId));
  const fixtures = scenario.world?.fixtures.filter(fixture => fixture.container && rooms.has(fixture.roomId)) ?? [];
  const owners = new Set([...characters, ...rooms, ...fixtures.map(fixture => fixture.id)]);
  return [...new Set([
    "world:context",
    ...[...characters].flatMap(id => [`character:${id}`, `actor:${id}`, `inventory:${id}`]),
    ...[...rooms].map(id => `inventory:${id}`),
    ...fixtures.flatMap(fixture => [`fixture:${fixture.id}`, `inventory:${fixture.id}`]),
    ...locatedItems(scenario).filter(item => owners.has(item.locationId)).map(item => `item:${item.id}`),
  ])];
}

/** A directory lets the GM discover remote context without preloading every resource. */
export function modelResourceOverview(scenario: Scenario): string {
  return [
    "Initial resources are a focused subset, not the entire world. Use read_state for exact remote state or missing generation IDs before writing.",
    "Resource keys: world:context; character:<id>, actor:<id>, inventory:<owner id>, item:<id>, fixture:<id>, door:<id>, doorway:<door id>, entity:<id>.",
    "Character directory: " + scenario.characters.map(character => `${character.name} [${character.id}]`).join("; "),
    "Authoritative world overview (not character knowledge):",
    renderWorldPrompt(scenario, { ...scenario.world!, objects: locatedItems(scenario) }),
  ].join("\n");
}
