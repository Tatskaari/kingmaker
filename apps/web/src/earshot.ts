import { renderPrompt } from "../../../packages/prompts/src/index.js";
import { courtPath } from "./court-map.js";
import type { DoorState, MapFixture } from "../../../packages/contracts/src/index.js";



export function courtCharactersWithinEarshot(speaker: PositionedCharacter, characters: readonly PositionedCharacter[], doors: readonly DoorState[] = [], fixtures: readonly MapFixture[] = []) {
  const heard = new Set<string>();
  return charactersWithinEarshot(speaker, characters).filter(listener => {
    if (heard.has(listener.id) || !courtPath(speaker.position!, listener.position!, doors, fixtures)) return false;
    heard.add(listener.id); return true;
  });
}

export interface PositionedCharacter {
  id: string;
  name: string;
  position?: { x: number; y: number } | undefined;
}

export interface EarshotCharacter extends PositionedCharacter {
  distance: number;
  level: "Clear" | "Moderate" | "Distant";
}

export const CLEAR_EARSHOT_DISTANCE = 3;
export const MODERATE_EARSHOT_DISTANCE = 6;
export const EARSHOT_DISTANCE = 10;
// The player gets a wider, clearer view of nearby activity than NPCs.
export const PLAYER_EARSHOT_DISTANCE = 15;
export const PLAYER_PERCEPTION_CHANCES = { Clear: 1, Moderate: 0.9, Distant: 0.6 };
// Address the speaking character directly, with names grouped beneath each warning.
export const EARSHOT_DESCRIPTIONS = {
  Clear: renderPrompt("earshot-clear"),
  Moderate: renderPrompt("earshot-nearby"),
  Distant: renderPrompt("earshot-distant"),
};

export const PERCEPTION_CHANCES: Record<EarshotCharacter["level"], number> = {
  Clear: 1,
  Moderate: 0.6,
  Distant: 0.3,
};

/** A single independent perception roll for a real-world event. */
export function perceivesAt(level: EarshotCharacter["level"], random: () => number = Math.random, isPlayer = false): boolean {
  return random() < (isPlayer ? PLAYER_PERCEPTION_CHANCES : PERCEPTION_CHANCES)[level];
}

export function charactersWithinEarshot(
  speaker: PositionedCharacter,
  characters: readonly PositionedCharacter[],
  maximumDistance = EARSHOT_DISTANCE,
): EarshotCharacter[] {
  if (!speaker.position) return [];
  return characters
    .filter(character => character.id !== speaker.id && character.position)
    .map(character => ({
      ...character,
      distance: Math.abs(character.position!.x - speaker.position!.x)
        + Math.abs(character.position!.y - speaker.position!.y),
    }))
    .filter(character => character.distance <= (character.id === "player" ? Math.max(maximumDistance, PLAYER_EARSHOT_DISTANCE) : maximumDistance))
    .map((character): EarshotCharacter => ({
      ...character,
      level: character.distance <= (character.id === "player" ? MODERATE_EARSHOT_DISTANCE : CLEAR_EARSHOT_DISTANCE) ? "Clear"
        : character.distance <= (character.id === "player" ? EARSHOT_DISTANCE : MODERATE_EARSHOT_DISTANCE) ? "Moderate" : "Distant",
    }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}
