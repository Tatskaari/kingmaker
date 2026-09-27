import { courtPath } from "./court-map.js";
import type { DoorState, MapFixture, Scenario } from "../../../packages/contracts/src/index.js";

export function dialogueEarshotPrompt(scenario: Scenario, speakerId: string, participantIds: readonly string[]): string {
  const characters = scenario.characters.map(character => ({ id: character.id, name: character.name,
    position: scenario.world?.actors.find(actor => actor.characterId === character.id)?.position }));
  const speaker = characters.find(character => character.id === speakerId);
  const listeners = speaker ? courtCharactersWithinEarshot(speaker, characters.filter(character => !participantIds.includes(character.id)), scenario.world?.doors, scenario.world?.fixtures) : [];
  return `# Current potential listeners\n${JSON.stringify({ positionKnown: !!speaker?.position,
    listeners: listeners.map(({ id, name, distance, level }) => ({ characterId: id, name, distance, level })), levels: EARSHOT_DESCRIPTIONS })}\nThese are nearby people outside this conversation who have a walkable path to you through the current doors. Consider their identities and your relationships before speaking about internal affairs or secret plans. You may be guarded, use indirect language, withhold details, or suggest a private meeting when your motives warrant it. Do not assume they actually listened or know your intentions. An empty list means no eligible listeners at these positions, not a permanent guarantee of privacy. Speech cannot close a door or move anyone; those require physical actions.`;
}

export function courtCharactersWithinEarshot(speaker: PositionedCharacter, characters: readonly PositionedCharacter[], doors: readonly DoorState[] = [], fixtures: readonly MapFixture[] = []) {
  return charactersWithinEarshot(speaker, characters).filter(listener =>
    !!courtPath(speaker.position!, listener.position!, doors, fixtures));
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

export const EARSHOT_DISTANCE = 6;
// Guidance for the later DM overhearing integration; not player-facing copy.
export const EARSHOT_DESCRIPTIONS = {
  Clear: "Can hear the conversation clearly.",
  Moderate: "Can hear a few words here and there, catching about half the conversation.",
  Distant: "Can catch names and places, but not the details.",
};

export const PERCEPTION_CHANCES: Record<EarshotCharacter["level"], number> = {
  Clear: 1,
  Moderate: 0.6,
  Distant: 0.3,
};

/** A single independent perception roll for a real-world event. */
export function perceivesAt(level: EarshotCharacter["level"], random: () => number = Math.random): boolean {
  return random() < PERCEPTION_CHANCES[level];
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
    .filter(character => character.distance <= maximumDistance)
    .map((character): EarshotCharacter => ({
      ...character,
      level: character.distance <= 1 ? "Clear" : character.distance <= 3 ? "Moderate" : "Distant",
    }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}
