import { EventVisibility, type Scenario } from "../../../packages/contracts/src/index.js";

/** Character intent/memory, physical actors, and inventories advance independently. */
export function stateResources(scenario: Scenario, activities: Record<string, unknown>, conversations: Record<string, unknown>) {
  const resources: Record<string, unknown> = {};
  const world = scenario.world;
  resources["world:context"] = { premise: scenario.premise, phase: world?.phase, day: world?.day,
    rooms: world?.rooms, facts: world?.facts, playerCharacterId: scenario.playerCharacterId };
  for (const character of scenario.characters) {
    resources[`character:${character.id}`] = { character, activity: activities[character.id] ?? null,
      conversation: conversations[character.id] ?? null,
      memories: scenario.events.filter(event => event.visibility === EventVisibility.PUBLIC || event.characterIds.includes(character.id)) };
    resources[`inventory:${character.id}`] = world?.objects.filter(item => item.locationId === character.id) ?? [];
    resources[`entity:${character.id}`] = "character";
  }
  for (const actor of world?.actors ?? []) resources[`actor:${actor.characterId}`] = actor;
  for (const fixture of world?.fixtures ?? []) {
    resources[`fixture:${fixture.id}`] = fixture;
    resources[`inventory:${fixture.id}`] = world?.objects.filter(item => item.locationId === fixture.id) ?? [];
    resources[`entity:${fixture.id}`] = "fixture";
  }
  for (const item of world?.objects ?? []) {
    resources[`item:${item.id}`] = item;
    resources[`entity:${item.id}`] = "item";
  }
  for (const door of world?.doors ?? []) {
    resources[`door:${door.id}`] = door;
    resources[`doorway:${door.id}`] = world!.actors.filter(actor => actor.position && door.tiles.some(tile => tile.x === actor.position!.x && tile.y === actor.position!.y));
  }
  for (const room of world?.rooms ?? []) resources[`entity:${room.id}`] = "room";
  return resources;
}
