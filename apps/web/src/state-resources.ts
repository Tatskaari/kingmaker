import { inventoryOwners, locatedItems } from "../../../packages/core/src/inventory.js";
import { NoteVisibility, type Scenario } from "../../../packages/contracts/src/index.js";

/** Character intent/memory, physical actors, and inventories advance independently. */
export function stateResources(scenario: Scenario, activities: Record<string, unknown>, conversations: Record<string, unknown>) {
  const resources: Record<string, unknown> = {};
  const world = scenario.world;
  resources["world:context"] = { premise: scenario.premise, phase: world?.phase, day: world?.day,
    rooms: world?.rooms.map(room => ({ ...room, inventory: undefined })), facts: world?.facts, playerCharacterId: scenario.playerCharacterId };
  for (const character of scenario.characters) {
    resources[`character:${character.id}`] = { character: { ...character, inventory: undefined }, activity: activities[character.id] ?? null,
      conversation: conversations[character.id] ?? null,
      notes: scenario.notes.filter(note => note.visibility === NoteVisibility.PUBLIC || note.characterIds.includes(character.id)) };
    resources[`inventory:${character.id}`] = character.inventory ?? null;
    resources[`entity:${character.id}`] = "character";
  }
  for (const actor of world?.actors ?? []) resources[`actor:${actor.characterId}`] = actor.instanceId
    ? world!.actors.filter(body => body.characterId === actor.characterId).sort((a, b) => (a.instanceId ?? "").localeCompare(b.instanceId ?? ""))
    : actor;
  for (const fixture of world?.fixtures ?? []) {
    resources[`fixture:${fixture.id}`] = { ...fixture, inventory: undefined };
    resources[`inventory:${fixture.id}`] = fixture.inventory ?? null;
    resources[`entity:${fixture.id}`] = "fixture";
  }
  for (const item of locatedItems(inventoryOwners(scenario.characters, scenario.world))) {
    resources[`item:${item.id}`] = item;
    resources[`entity:${item.id}`] = "item";
  }
  for (const door of world?.doors ?? []) {
    resources[`door:${door.id}`] = door;
    resources[`doorway:${door.id}`] = world!.actors.filter(actor => actor.position && door.tiles.some(tile => tile.x === actor.position!.x && tile.y === actor.position!.y));
  }
  for (const room of world?.rooms ?? []) {
    resources[`entity:${room.id}`] = "room";
    resources[`inventory:${room.id}`] = room.inventory ?? null;
  }
  return resources;
}
