import { renderWorldPrompt } from "./world-prompt.js";
import { inventoryOwners, locatedItems } from "./inventory.js";
import { IMMEDIATE_GOAL_GUIDANCE } from "./goal-guidance.js";
import { clone, toJson } from "@bufbuild/protobuf";
import {
  NoteVisibility,
  GamePhase,
  TranscriptRole,
  WorldStateSchema,
  ItemInstanceSchema,
  type Scenario,
  type DialogueRequest,
  type Note,
  type GameMasterRequest,
} from "../../contracts/src/index.js";
import type { DialogueContextBuilder, GameMasterContextBuilder, PromptMessage } from "./ports.js";

function visibleNotes(notes: readonly Note[], characterId: string): readonly Note[] {
  return notes.filter(note =>
    note.visibility === NoteVisibility.PUBLIC || note.characterIds.includes(characterId),
  );
}

/** Shared authored character context for dialogue and physical decisions. */
export function characterContextFor(scenario: Scenario, characterId: string) {
  const character = scenario.characters.find(item => item.id === characterId);
  if (!character) throw new Error(`Cannot build context for unknown character ${characterId}`);
  return { character, premise: scenario.premise, notes: visibleNotes(scenario.notes, characterId) };
}

/** Plain data for a decision model; the task overrides current intent, not biography. */
export function characterDecisionContext(scenario: Scenario, characterId: string, goal: string) {
  const { character, premise, notes } = characterContextFor(scenario, characterId);
  return {
    premise,
    character: {
      id: character.id, name: character.name, gender: character.gender, delegation: character.delegation, lore: character.lore,
      relationships: character.relationships.map(({ characterId, description }) => ({ characterId, description })),
      parkedObjectives: character.parkedObjectives,
      activeObjective: character.activeObjective,
      currentGoal: goal,
    },
    notes: notes.map(({ id, day, text }) => ({ id, day, text })),
  };
}

/** Removes concealed container contents and undiscovered fixture details. The game master sees
 * the authoritative world; character models see only this projection. */
export function worldForCharacter(scenario: Scenario, characterId: string) {
  const view = Object.assign(clone(WorldStateSchema, scenario.world!), { objects: locatedItems(inventoryOwners(scenario.characters, scenario.world)) });
  const visibleObjectIds = new Set<string>();

  for (const fixture of view.fixtures) {
    const known = fixture.open || fixture.searchedBy.includes(characterId);
    if (known) for (const item of view.objects) {
      if (item.locationId === fixture.id) visibleObjectIds.add(item.id);
    }
    if (fixture.inventory) fixture.inventory.items = fixture.inventory.items.filter(item => known || !item.concealed);
    if (!fixture.examinedBy.includes(characterId)) {
      fixture.requiredKeyId = "";
      fixture.revealedName = "";
    }
    fixture.examinedBy = fixture.examinedBy.filter(id => id === characterId);
    fixture.searchedBy = fixture.searchedBy.filter(id => id === characterId);
  }

  view.objects = view.objects.filter(object => !object.concealed || object.locationId === characterId || visibleObjectIds.has(object.id));
  for (const room of view.rooms) if (room.inventory) room.inventory.items = room.inventory.items.filter(item => !item.concealed);
  return view;
}

/** Flattened prompt/debug projection only; never persisted as authoritative ownership. */
export function worldViewJson(view: ReturnType<typeof worldForCharacter>) {
  return { ...toJson(WorldStateSchema, view, { alwaysEmitImplicit: true }) as object,
    objects: view.objects.map(item => ({ ...toJson(ItemInstanceSchema, item) as object, locationId: item.locationId })) };
}

export class FullContextBuilder implements DialogueContextBuilder {
  build(request: DialogueRequest): readonly PromptMessage[] {
    const scenario = request.scenario;
    if (!scenario || !scenario.world) {
      throw new Error(`Cannot build context for unknown character ${request.characterId}`);
    }

    const { character, notes } = characterContextFor(scenario, request.characterId);
    const player = scenario.characters.find(item => item.id === scenario.playerCharacterId);
    const visitor = player ? `\n\n# Visiting player’s public identity\n${JSON.stringify({ name: player.name, gender: player.gender, delegation: player.delegation, dnd: player.dnd })}` : "";
    const relationships = character.relationships.length
      ? character.relationships.map(item => `- ${item.characterId}: ${item.description}`).join("\n")
      : "- None recorded.";
    const recent = notes.length
      ? notes.map(note => `- [day ${note.day}] ${note.text}`).join("\n")
      : "- Nothing has happened yet.";

    const setup: PromptMessage[] = [
      { role: "system", content: scenario.systemPrompt },
      { role: "system", content: `# Scenario premise\n${scenario.premise}` },
      {
        role: "system",
        content: `# Dialogue objectives\n${character.dialogueObjectives.map((objective, index) => `${index + 1}. ${objective}`).join("\n") || "No particular conversational objectives."}\nThese are outcomes the character hopes to reach through natural conversation, in priority order. Pursue only what fits the current exchange; do not recite or exhaust the list, force a subject, reveal facts the character does not know, or override their motives.\n\n# Character\n${character.name} (${character.id})\n\n${character.lore}\n\n# Identity\nGender: ${character.gender || "Not recorded"}\nDelegation: ${character.delegation || "Not recorded"}\n\n# Parked objectives\n${character.parkedObjectives.map(objective => `- ${objective.name}: ${objective.status} Success criteria: ${objective.successCriteria}`).join("\n") || "None recorded."}\nThese retained undertakings inform dialogue and intentions, but their goals are not action-planner tasks unless reactivated.\n\n# Current goal\n${character.currentGoal || "No goal yet."}\n\n${IMMEDIATE_GOAL_GUIDANCE}`,
      },
      ...(character.activeObjective ? [{ role: "system" as const, content: `# Active objective\n${JSON.stringify(character.activeObjective)}\nThe current goal is one step toward this objective, not the entire undertaking.` }] : []),
      { role: "system", content: `# Relationships\n${relationships}${visitor}` },
      { role: "system", content: `# Notes available to this character\n${recent}` },
      {
        role: "system",
        content: `# Known world state\n${renderWorldPrompt(scenario, worldForCharacter(scenario, character.id), character.id)}`,
      },
    ];

    const transcript: PromptMessage[] = request.transcript.map(message => ({
      role: message.role === TranscriptRole.GAME_MASTER ? "system" : message.role === TranscriptRole.CHARACTER ? "assistant" : "user",
      content: message.role === TranscriptRole.OTHER_CHARACTER
        ? `${message.speakerId}: ${message.text}`
        : message.text,
    }));
    return [...setup, ...transcript];
  }
}

export class FullGameMasterContextBuilder implements GameMasterContextBuilder {
  build(request: GameMasterRequest): readonly PromptMessage[] {
    const scenario = request.scenario;
    if (!scenario?.world) throw new Error("Cannot build game-master context without a scenario world");

    const cast = scenario.characters.map(character => ({
      id: character.id,
      name: character.name,
      lore: character.lore,
      inventory: character.inventory,
      dnd: character.dnd,
      parkedObjectives: character.parkedObjectives,
      activeObjective: character.activeObjective,
      currentGoal: character.currentGoal,
      dialogueObjectives: character.dialogueObjectives,
      relationships: character.relationships,
    }));
    const setup: PromptMessage[] = [
      { role: "system", content: scenario.gameMasterPrompt },
      { role: "system", content: `# Scenario premise\n${scenario.premise}` },
      { role: "system", content: `# Existing cast\n${JSON.stringify(cast)}` },
      {
        role: "system",
        content: `# Complete world state\n${renderWorldPrompt(scenario, { ...scenario.world, objects: locatedItems(inventoryOwners(scenario.characters, scenario.world)) })}`,
      },
      {
        role: "system",
        content: scenario.world.phase === GamePhase.PLAYER_CREATION
          ? "# Current task\nInterview the player and create them when enough is known."
          : "# Current task\nNarrate the current phase and its consequences.",
      },
    ];
    const transcript: PromptMessage[] = request.transcript.map(message => ({
      role: message.role === TranscriptRole.GAME_MASTER ? "assistant" : "user",
      content: message.text,
    }));
    return [...setup, ...transcript];
  }
}
