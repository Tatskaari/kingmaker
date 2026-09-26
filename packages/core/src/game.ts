import { clone, create } from "@bufbuild/protobuf";
import {
  ActorStateSchema,
  CharacterSchema,
  EventSchema,
  EventVisibility,
  GamePhase,
  ScenarioSchema,
  type Character,
  type ConversationMemory,
  type Event,
  type PlayerSetup,
  type Scenario,
} from "../../contracts/src/index.js";
import type { GameState, Validation } from "./ports.js";

const NPC_IDS = ["merlin", "lancelot", "king"] as const;

function failure<T>(code: string, message: string): Validation<T> {
  return { ok: false, issues: [{ code, message }] };
}

export class MemoryGame implements GameState {
  readonly #scenario: Scenario;
  #eventSequence = 0;

  constructor(scenario: Scenario) {
    this.#scenario = clone(ScenarioSchema, scenario);
  }

  scenario(): Scenario {
    return clone(ScenarioSchema, this.#scenario);
  }

  createPlayer(setup: PlayerSetup): Validation<Character> {
    if (this.#scenario.playerCharacterId) return failure("player_exists", "The player already exists.");
    if (!setup.player) return failure("missing_player", "Player setup has no character.");
    const world = this.#scenario.world;
    if (!world) return failure("missing_world", "Scenario has no world.");
    const owners = new Set(setup.npcRelationships.map(update => update.ownerCharacterId));
    if (NPC_IDS.some(id => !owners.has(id))) {
      return failure("missing_relationship", "The game master must describe every NPC's relationship to the player.");
    }

    const player = clone(CharacterSchema, setup.player);
    player.id = "player";
    for (const npcId of NPC_IDS) {
      if (!player.relationships.some(relationship => relationship.characterId === npcId)) {
        return failure("missing_player_relationship", `The player needs a relationship to ${npcId}.`);
      }
    }
    this.#scenario.characters.push(player);
    this.#scenario.playerCharacterId = player.id;

    for (const update of setup.npcRelationships) {
      const npc = this.#scenario.characters.find(character => character.id === update.ownerCharacterId);
      if (!npc || !update.relationship) continue;
      const relationship = { ...update.relationship, characterId: player.id };
      npc.relationships = [
        ...npc.relationships.filter(item => item.characterId !== player.id),
        relationship,
      ];
    }

    world.day = 1;
    world.phase = GamePhase.CONVERSATIONS;
    world.revision += 1;
    for (const actor of world.actors) {
      actor.roomId = "great_hall";
      actor.awake = true;
    }
    world.actors.push(create(ActorStateSchema, {
      characterId: player.id,
      homeRoomId: "guest_chamber",
      roomId: "great_hall",
      awake: true,
    }));

    for (const actor of world.actors) {
      const placement = this.#scenario.courtArrivalPlacements.find(item => item.characterId === actor.characterId);
      // Crossing into the court invalidates the old bedroom tile.
      actor.position = placement?.position ? { ...placement.position } : undefined;
      if (placement) actor.roomId = placement.roomId;
    }

    const identity = `${player.name}, ${setup.embassyRole} from ${setup.homeland}`;
    for (const npcId of NPC_IDS) {
      this.#scenario.events.push(create(EventSchema, {
        id: `arrival-${npcId}`,
        day: world.day,
        type: "arrival",
        summary: `${identity}, has arrived with the diplomatic delegation and is greeting ${npcId} in the Great Hall.`,
        characterIds: [npcId, player.id],
        visibility: EventVisibility.PRIVATE,
        details: { homeland: setup.homeland, embassyRole: setup.embassyRole },
      }));
    }
    return { ok: true, value: clone(CharacterSchema, player) };
  }

  commitConversation(characterId: string, memory: ConversationMemory, includePlayer = true): Validation<readonly Event[]> {
    const character = this.#scenario.characters.find(item => item.id === characterId);
    if (!character || characterId === "player") return failure("unknown_character", "Unknown NPC.");
    if (!this.#scenario.world) return failure("missing_world", "Scenario has no world.");
    const targets = new Set<string>();
    for (const relationship of memory.relationships) {
      if (relationship.characterId === characterId || targets.has(relationship.characterId)
        || !this.#scenario.characters.some(item => item.id === relationship.characterId)
        || !relationship.description.trim()) {
        return failure("invalid_relationship", "Memory contains an invalid or duplicate relationship.");
      }
      targets.add(relationship.characterId);
    }
    // Validate everything before applying any part of the review.
    if (memory.newEvents.some(event => !event.type.trim() || !event.summary.trim())
      || (memory.goalUpdate && !memory.goalUpdate.goal.trim())
      || (memory.lore !== undefined && !memory.lore.trim())) {
      return failure("invalid_memory", "Memory updates must not be empty.");
    }
    const events = memory.newEvents.map(event => create(EventSchema, {
      id: `conversation-${crypto.randomUUID()}`,
      day: this.#scenario.world!.day,
      type: event.type,
      summary: event.summary,
      characterIds: includePlayer ? [characterId, "player"] : [characterId],
      visibility: EventVisibility.PRIVATE,
    }));
    if (memory.goalUpdate) character.currentGoal = memory.goalUpdate.goal;
    if (memory.lore !== undefined) character.lore = memory.lore;
    for (const relationship of memory.relationships) {
      character.relationships = character.relationships.filter(item => item.characterId !== relationship.characterId);
      character.relationships.push({ ...relationship });
    }
    this.#scenario.events.push(...events);
    this.#scenario.world.revision += 1;
    return { ok: true, value: events };
  }

  updateCharacter(characterId: string, lore?: string, currentGoal?: string): Validation<Character> {
    const character = this.#scenario.characters.find(item => item.id === characterId);
    if (!character) return failure("unknown_character", `Unknown character ${characterId}.`);
    if (lore) character.lore = lore;
    if (currentGoal) character.currentGoal = currentGoal;
    return { ok: true, value: clone(CharacterSchema, character) };
  }

  updatePremise(premise: string): void {
    this.#scenario.premise = premise;
  }

  addEvent(event: Event): Event {
    const world = this.#scenario.world;
    const normalized = create(EventSchema, {
      ...event,
      id: event.id || `gm-${++this.#eventSequence}`,
      day: world?.day ?? 0,
    });
    this.#scenario.events.push(normalized);
    return normalized;
  }
}
