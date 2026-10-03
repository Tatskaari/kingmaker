import { inventoryOwners, validateInventories } from "./inventory.js";
import { clone, create } from "@bufbuild/protobuf";
import {
  ActorStateSchema,
  ActiveObjectiveSchema,
  CharacterSchema,
  NoteSchema,
  NoteVisibility,
  GamePhase,
  ScenarioSchema,
  type Character,
  type ConversationMemory,
  type Note,
  type PlayerSetup,
  type Scenario,
} from "../../contracts/src/index.js";
import type { GameState, Validation } from "./ports.js";

function failure<T>(code: string, message: string): Validation<T> {
  return { ok: false, issues: [{ code, message }] };
}

export class MemoryGame implements GameState {
  readonly #scenario: Scenario;
  #noteSequence = 0;

  constructor(scenario: Scenario) {
    validateInventories(inventoryOwners(scenario.characters, scenario.world));
    this.#scenario = clone(ScenarioSchema, scenario);
    for (const character of this.#scenario.characters) {
      for (const name of character.objectives) character.parkedObjectives.push(create(ActiveObjectiveSchema, {
        name, status: "This enduring ambition is parked. No current execution plan has been adopted.",
        successCriteria: name, currentGoal: "",
      }));
      character.objectives = [];
      if (character.activeObjective) character.activeObjective.currentGoal = character.currentGoal;
      else if (character.id !== this.#scenario.playerCharacterId && character.currentGoal.trim()) character.activeObjective = create(ActiveObjectiveSchema, {
        name: character.currentGoal.split(".")[0]!,
        status: "No progress has been recorded yet. Next: " + character.currentGoal,
        successCriteria: "The task has been completed in the world, not merely promised.",
        currentGoal: character.currentGoal,
      });
    }
  }

  scenario(): Scenario {
    return clone(ScenarioSchema, this.#scenario);
  }

  createPlayer(setup: PlayerSetup): Validation<Character> {
    if (this.#scenario.playerCharacterId) return failure("player_exists", "The player already exists.");
    if (!setup.player) return failure("missing_player", "Player setup has no character.");
    const world = this.#scenario.world;
    if (!world) return failure("missing_world", "Scenario has no world.");
    const npcIds = this.#scenario.characters.map(character => character.id);
    const owners = new Set(setup.npcRelationships.map(update => update.ownerCharacterId));
    if (setup.npcRelationships.length !== npcIds.length || npcIds.some(id => !owners.has(id))
      || setup.npcRelationships.some(update => !update.relationship?.description.trim())) {
      return failure("missing_relationship", "The game master must describe every NPC's relationship to the player.");
    }

    const player = clone(CharacterSchema, setup.player);
    player.id = "player";
    if (player.relationships.length !== npcIds.length || player.relationships.some(item => !item.description.trim())) {
      return failure("invalid_player_relationships", "Describe exactly one initial relationship with every court character.");
    }
    for (const npcId of npcIds) {
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

    const identity = `${player.name}, ${setup.embassyRole}${setup.homeland === "Independent" ? "" : ` from ${setup.homeland}`}`;
    for (const npcId of npcIds) {
      this.#scenario.notes.push(create(NoteSchema, {
        id: `arrival-${npcId}`,
        day: world.day,
        text: `${identity}, has arrived${setup.homeland === "Independent" ? " independently" : " with the diplomatic delegation"} and is greeting ${npcId} in the Great Hall.`,
        characterIds: [npcId, player.id],
        visibility: NoteVisibility.PRIVATE,
        details: { homeland: setup.homeland, embassyRole: setup.embassyRole },
      }));
    }
    return { ok: true, value: clone(CharacterSchema, player) };
  }

  commitConversation(characterId: string, memory: ConversationMemory, includePlayer = true): Validation<readonly Note[]> {
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
    if (memory.newNotes.some(note => !note.trim())
      || (memory.goalUpdate && !memory.goalUpdate.goal.trim())
      || (memory.lore !== undefined && !memory.lore.trim())) {
      return failure("invalid_memory", "Memory updates must not be empty.");
    }
    const notes = memory.newNotes.map(text => create(NoteSchema, {
      id: `note-${crypto.randomUUID()}`,
      day: this.#scenario.world!.day,
      text,
      characterIds: includePlayer ? [characterId, "player"] : [characterId],
      visibility: NoteVisibility.PRIVATE,
    }));
    if (memory.goalUpdate) {
      character.currentGoal = memory.goalUpdate.goal;
      character.activeObjective = create(ActiveObjectiveSchema, {
        name: memory.goalUpdate.goal.split(".")[0]!,
        status: "This objective was created from a reviewed conversation. No progress has been recorded yet. Next: " + memory.goalUpdate.goal,
        successCriteria: "The task has been completed in the world, not merely promised.",
        currentGoal: memory.goalUpdate.goal,
      });
    }
    if (memory.lore !== undefined) character.lore = memory.lore;
    for (const relationship of memory.relationships) {
      character.relationships = character.relationships.filter(item => item.characterId !== relationship.characterId);
      character.relationships.push({ ...relationship });
    }
    this.#scenario.notes.push(...notes);
    this.#scenario.world.revision += 1;
    return { ok: true, value: notes };
  }

  updateCharacter(characterId: string, lore?: string, currentGoal?: string, dialogueObjectives?: string[]): Validation<Character> {
    const character = this.#scenario.characters.find(item => item.id === characterId);
    if (!character) return failure("unknown_character", `Unknown character ${characterId}.`);
    if (lore) character.lore = lore;
    if (currentGoal !== undefined) character.currentGoal = currentGoal;
    if (dialogueObjectives !== undefined) character.dialogueObjectives = dialogueObjectives;
    if (character.activeObjective) character.activeObjective.currentGoal = character.currentGoal;
    return { ok: true, value: clone(CharacterSchema, character) };
  }

  updatePremise(premise: string): void {
    this.#scenario.premise = premise;
  }

  addNote(note: Note): Note {
    const world = this.#scenario.world;
    const normalized = create(NoteSchema, {
      ...note,
      id: note.id || `gm-note-${++this.#noteSequence}`,
      day: world?.day ?? 0,
    });
    this.#scenario.notes.push(normalized);
    return normalized;
  }
}
