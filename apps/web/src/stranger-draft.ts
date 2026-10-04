import { strangerConfiguration } from "./stranger-lore.js";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { PlayerSetupSchema, type PlayerSetup } from "../../../packages/contracts/src/index.js";
import { CharacterPropertiesSchema, type WorldState } from "../../../packages/contracts/src/v2.js";
import { links } from "../../../packages/lore/src/markdown.js";
import type { CharacterCreation } from "../../../packages/lore/src/services.js";
import { characterId } from "../../../packages/lore/src/character-id.js";
import { buildInterviewCharacter, validatePlayerStats } from "./player-build.js";
import { characterSprites } from "./introduction.js";

export const creationAffiliations = (world: WorldState) => strangerConfiguration(world).affiliations;
export function creationText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  if (links(value).length) throw new Error(`${label} must be plain prose without document links.`);
  return value.trim();
}
export function validateDraft(setup: PlayerSetup, world: WorldState) {
  const player = setup.player;
  if (!player || player.id !== "player") throw new Error("A player character is required.");
  for (const key of ["name", "gender", "lore", "currentGoal"] as const) player[key] = creationText(player[key], key);
  if (player.name.length > 80 || player.gender.length > 40) throw new Error("Name or gender is too long.");
  if (!creationAffiliations(world).includes(player.delegation)) throw new Error("Choose a court affiliation.");
  if (!characterSprites.some(sprite => sprite === player.sprite)) throw new Error("Choose an available appearance.");
  setup.homeland = player.delegation;
  setup.presentation = creationText(setup.presentation, "Presentation");
  setup.embassyRole = creationText(setup.embassyRole, "Role");
  validatePlayerStats(player.dnd);
  const ids = world.characters.map(path => characterId(path, world));
  for (const entries of [player.relationships, setup.npcRelationships.map(item => ({ characterId: item.ownerCharacterId, description: item.relationship?.description }))]) {
    if (entries.length !== ids.length || new Set(entries.map(item => item.characterId)).size !== ids.length
      || entries.some(item => !ids.includes(item.characterId))) throw new Error("Describe exactly one relationship with every court character.");
    for (const entry of entries) creationText(entry.description, "Relationship");
  }
  if (setup.npcRelationships.some(item => item.relationship?.characterId !== "player")) throw new Error("NPC impressions must concern the player.");
  return setup;
}
export function interviewDraft(input: Record<string, unknown>, world: WorldState): JsonValue {
  const entries = (value: unknown) => {
    if (!Array.isArray(value)) throw new Error("Relationships are required.");
    return value.map(item => ({ characterId: creationText(item?.characterId, "Character ID"), description: creationText(item?.description, "Relationship") }));
  };
  const setup = create(PlayerSetupSchema, {
    presentation: creationText(input.presentation, "Presentation"),
    homeland: creationText(input.homeland, "Court affiliation"), embassyRole: creationText(input.embassyRole, "Role"),
    player: { id: "player", name: creationText(input.name, "Name"), gender: creationText(input.gender, "Gender"),
      delegation: creationText(input.homeland, "Court affiliation"), sprite: 98,
      lore: creationText(input.lore, "Biography"), currentGoal: creationText(input.currentGoal, "Goal"),
      ...buildInterviewCharacter(input.build), relationships: entries(input.relationships) },
    npcRelationships: entries(input.npcViews).map(item => ({ ownerCharacterId: item.characterId,
      relationship: { characterId: "player", description: item.description } })),
  });
  return toJson(PlayerSetupSchema, validateDraft(setup, world));
}
export function playerPublication(value: JsonValue, assigned: JsonValue, world: WorldState): CharacterCreation & { impressions: Record<string, string> } {
  const setup = validateDraft(fromJson(PlayerSetupSchema, value), world), player = setup.player!;
  const gear = fromJson(PlayerSetupSchema, assigned).player?.inventory;
  const prose = (value: string) => value.replace(/[\\`*_[\]<>#]/g, "\\$&");
  return { id: "player", path: "Players/player.md", text: `---\n${stringify({
    name: player.name, gender: player.gender, delegation: player.delegation, sprite: player.sprite,
    summary: `${player.name}'s identity, background, personal goal and relationships.`,
    visibility: "private", readers: ["character:player"],
  })}---\n# Your character\n${prose(player.lore)}\n\n## Public role\n${prose(setup.embassyRole)}\n\n## Relationships\n${player.relationships.map(item => `- ${item.characterId}: ${prose(item.description)}`).join("\n")}\n`,
    presentation: creationText(setup.presentation, "Presentation"),
    properties: create(CharacterPropertiesSchema, { dnd: player.dnd, ...(gear ? { inventory: gear } : {}) }),
    impressions: Object.fromEntries(setup.npcRelationships.map(item => [world.characters.find(path => characterId(path, world) === item.ownerCharacterId)!, item.relationship!.description])),
  };
}
