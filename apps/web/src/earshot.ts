export interface PositionedCharacter {
  id: string;
  name: string;
  position?: { x: number; y: number };
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
