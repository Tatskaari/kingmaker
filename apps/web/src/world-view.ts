import { actorPosition } from "../../../packages/core/src/simulation-movement.js";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { DndCharacterSchema, TranscriptMessageSchema, TranscriptRole } from "../../../packages/contracts/src/index.js";
import type { WorldState } from "../../../packages/contracts/src/v2.js";
import { inventoryOwners, itemsFor } from "../../../packages/core/src/inventory.js";
import { fixtureActions } from "../../../packages/core/src/fixtures.js";
import { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import { characterDocuments } from "../../../packages/lore/src/character-id.js";
import { activityGoal } from "../../../packages/lore/src/activity.js";
import { foregroundBodies } from "./background-characters.js";
import type { MechanicalActivity } from "./palace-mechanics.js";

/** Browser presentation reads document entries and physical state directly. */
export function worldView(world: WorldState, activity: MechanicalActivity, atMs = Date.now()) {
  const map = world.simulation!.map;
  if (!map) throw new Error("A physical map is required.");
  const characters = characterDocuments(world).map(({ id, document, character }) => ({ id, document, character,
    name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
    sprite: typeof document.frontmatter?.sprite === "number" ? document.frontmatter.sprite : undefined,
    currentGoal: id === "player" ? "" : activityGoal(world, id) ?? "",
    inventory: character.inventory }));
  const player = characters.find(character => character.id === "player"), playerId = player?.id ?? "";
  const actors = foregroundBodies(map.actors, actorPosition(map.actors.find(actor => actor.characterId === playerId), atMs), atMs);
  const actor = actors.find(actor => actor.characterId === playerId);
  const owners = inventoryOwners(characters, map);
  return {
    revision: map.revision, day: map.day,
    npcActivities: Object.fromEntries(characters.filter(character => character.id !== playerId).map(character => [character.id,
      activity.npcActivities?.[character.id] ?? { status: "idle", goal: character.currentGoal, history: [] }])),
    doors: map.doors,
    fixtures: worldForCharacter(map, owners, playerId).fixtures,
    fixtureActions: fixtureActions(map.fixtures, owners, playerId),
    inventory: itemsFor(owners, playerId).map(({ id, name, details }) => ({ id, name, details })),
    roomAccess: map.rooms.map(({ id, private: restricted, allowedCharacterIds }) => ({ id, private: restricted, allowedCharacterIds })),
    location: map.rooms.find(room => room.id === actor?.roomId)?.name || "Great Hall",
    premise: "",
    player: player ? {
      id: player.id, name: player.name, sprite: player.sprite,
      gender: typeof player.document.frontmatter?.gender === "string" ? player.document.frontmatter.gender : "",
      delegation: typeof player.document.frontmatter?.delegation === "string" ? player.document.frontmatter.delegation : "",
      dnd: player.character.dnd ? toJson(DndCharacterSchema, player.character.dnd, { alwaysEmitImplicit: true }) : null,
      position: actor?.position, movement: actor?.movement, roomId: actor?.roomId, lore: player.document.body, currentGoal: player.currentGoal,
      relationships: [],
    } : null,
    characters: characters.filter(character => character.id !== "player").flatMap(character =>
      actors.filter(actor => actor.characterId === character.id).map(actor => ({ id: character.id,
        instanceId: actor.instanceId || character.id, name: character.name, sprite: character.sprite, physicalForm: actor.physicalForm,
        dialogueObjectives: [], activeObjective: undefined, currentGoal: character.currentGoal,
        position: actor.position, movement: actor.movement, roomId: actor.roomId }))),
    conversationReplyOptions: activity.conversationReplyOptions ?? {},
    conversationEndRequested: activity.conversationEndRequested ?? {},
    conversations: Object.fromEntries(Object.entries(activity.conversations).map(([id, turns]) => [id,
      turns.map(turn => fromJson(TranscriptMessageSchema, turn)).filter(message => message.role !== TranscriptRole.GAME_MASTER)
        .map(message => ({ role: message.role === TranscriptRole.CHARACTER ? "character" : "player", text: message.text }))])),
  };
}
