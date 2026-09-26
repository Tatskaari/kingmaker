import { IMMEDIATE_GOAL_GUIDANCE } from "./goal-guidance.js";
import { clone, toJson } from "@bufbuild/protobuf";
import {
  EventVisibility,
  GamePhase,
  TranscriptRole,
  WorldStateSchema,
  type Scenario,
  type DialogueRequest,
  type Event,
  type GameMasterRequest,
  type WorldState,
} from "../../contracts/src/index.js";
import type { DialogueContextBuilder, GameMasterContextBuilder, PromptMessage } from "./ports.js";

function visibleEvents(events: readonly Event[], characterId: string): readonly Event[] {
  return events.filter(event =>
    event.visibility === EventVisibility.PUBLIC || event.characterIds.includes(characterId),
  );
}

/** Shared authored character context for dialogue and physical decisions. */
export function characterContextFor(scenario: Scenario, characterId: string) {
  const character = scenario.characters.find(item => item.id === characterId);
  if (!character) throw new Error(`Cannot build context for unknown character ${characterId}`);
  return { character, premise: scenario.premise, events: visibleEvents(scenario.events, characterId) };
}

/** Plain data for a decision model; the task overrides current intent, not biography. */
export function characterDecisionContext(scenario: Scenario, characterId: string, goal: string) {
  const { character, premise, events } = characterContextFor(scenario, characterId);
  return {
    premise,
    character: {
      id: character.id, name: character.name, lore: character.lore,
      relationships: character.relationships.map(({ characterId, description }) => ({ characterId, description })),
      motivation: character.currentGoal,
      currentGoal: goal,
    },
    visibleEvents: events.map(({ id, day, type, summary }) => ({ id, day, type, summary })),
  };
}

/** Removes undiscovered search spots and concealed objects. The game master sees
 * the authoritative world; character models see only this projection. */
export function worldForCharacter(world: WorldState, characterId: string): WorldState {
  const view = clone(WorldStateSchema, world);
  const visibleObjectIds = new Set<string>();

  for (const room of view.rooms) {
    room.searchSpots = room.searchSpots.filter(spot => {
      const known = spot.knownByCharacterIds.includes(characterId);
      const discovered = spot.discoveredByCharacterIds.includes(characterId);
      const searched = spot.searchedByCharacterIds.includes(characterId);
      if (!known && !discovered && !searched) return false;
      if (known || searched) {
        for (const objectId of spot.contentObjectIds) visibleObjectIds.add(objectId);
      } else {
        spot.contentObjectIds = [];
      }
      spot.knownByCharacterIds = known ? [characterId] : [];
      spot.discoveredByCharacterIds = discovered ? [characterId] : [];
      spot.searchedByCharacterIds = searched ? [characterId] : [];
      return true;
    });
  }

  // Objects inside a known object are also known, such as the crown in its box.
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of view.objects) {
      if (object.concealed && visibleObjectIds.has(object.locationId) && !visibleObjectIds.has(object.id)) {
        visibleObjectIds.add(object.id);
        changed = true;
      }
    }
  }
  view.objects = view.objects.filter(object => !object.concealed || visibleObjectIds.has(object.id));
  return view;
}

export class FullContextBuilder implements DialogueContextBuilder {
  build(request: DialogueRequest): readonly PromptMessage[] {
    const scenario = request.scenario;
    if (!scenario || !scenario.world) {
      throw new Error(`Cannot build context for unknown character ${request.characterId}`);
    }

    const { character, events } = characterContextFor(scenario, request.characterId);
    const relationships = character.relationships.length
      ? character.relationships.map(item => `- ${item.characterId}: ${item.description}`).join("\n")
      : "- None recorded.";
    const recent = events.length
      ? events.map(event => `- [day ${event.day}] ${event.type}: ${event.summary}`).join("\n")
      : "- Nothing has happened yet.";

    const setup: PromptMessage[] = [
      { role: "system", content: scenario.systemPrompt },
      { role: "system", content: `# Scenario premise\n${scenario.premise}` },
      {
        role: "system",
        content: `# Character\n${character.name} (${character.id})\n\n${character.lore}\n\n# Current goal\n${character.currentGoal || "No goal yet."}\n\n${IMMEDIATE_GOAL_GUIDANCE}`,
      },
      { role: "system", content: `# Relationships\n${relationships}` },
      { role: "system", content: `# Events visible to this character\n${recent}` },
      {
        role: "system",
        content: `# Known world state\n${JSON.stringify(toJson(WorldStateSchema, worldForCharacter(scenario.world, character.id), { alwaysEmitImplicit: true }), null, 2)}`,
      },
    ];

    const transcript: PromptMessage[] = request.transcript.map(message => ({
      role: message.role === TranscriptRole.CHARACTER ? "assistant" : "user",
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
      currentGoal: character.currentGoal,
      relationships: character.relationships,
    }));
    const setup: PromptMessage[] = [
      { role: "system", content: scenario.gameMasterPrompt },
      { role: "system", content: `# Scenario premise\n${scenario.premise}` },
      { role: "system", content: `# Existing cast\n${JSON.stringify(cast, null, 2)}` },
      {
        role: "system",
        content: `# Complete world state\n${JSON.stringify(toJson(WorldStateSchema, scenario.world, { alwaysEmitImplicit: true }), null, 2)}`,
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
