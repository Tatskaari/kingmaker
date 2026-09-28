import { courtPath, courtRoomAt } from "./court-map.js";
import { palaceNodes } from "./palace-navigation.js";
import { doorActionLegality } from "../../../packages/core/src/access.js";
import type { DoorState, MapFixture, Scenario } from "../../../packages/contracts/src/index.js";

export function dialogueEarshotPrompt(scenario: Scenario, speakerId: string, participantIds: readonly string[]): string {
  const world = scenario.world;
  const characters = scenario.characters.map(character => ({ id: character.id, name: character.name,
    position: world?.actors.find(actor => actor.characterId === character.id)?.position }));
  const speaker = characters.find(character => character.id === speakerId);
  const speakerActor = world?.actors.find(actor => actor.characterId === speakerId);
  const currentRoom = world?.rooms.find(room => room.id === speakerActor?.roomId);
  const participantActors = participantIds.map(characterId => world?.actors.find(actor => actor.characterId === characterId));
  const meetingPoints = world && participantActors.every(actor => actor?.position) ? palaceNodes.flatMap(node => {
    const mapRoom = courtRoomAt(node);
    const room = world.rooms.find(item => item.id === mapRoom?.id);
    const permitted = room && (!room.private || participantIds.every(characterId => room.allowedCharacterIds.includes(characterId)));
    const reachable = participantActors.every((actor, index) => {
      const characterId = participantIds[index]!;
      const traversableDoors = world.doors.map(door => door.open || doorActionLegality(door, world.rooms, characterId) === "normal"
        ? { ...door, open: true } : door);
      return courtPath(actor!.position!, node, traversableDoors, world.fixtures);
    });
    return permitted && reachable ? [{ id: node.id, name: node.name, roomId: room.id, private: room.private }] : [];
  }) : [];
  const listeners = speaker ? courtCharactersWithinEarshot(speaker, characters.filter(character => !participantIds.includes(character.id)), world?.doors, world?.fixtures) : [];
  return `# Conversation privacy\n${JSON.stringify({ positionKnown: !!speaker?.position,
    currentRoom: currentRoom ? { roomId: currentRoom.id, name: currentRoom.name, private: currentRoom.private } : null,
    listeners: listeners.map(({ id, name, distance, level }) => ({ characterId: id, name, distance, level })),
    levels: EARSHOT_DESCRIPTIONS,
    meetingPoints,
  })}\nThe listeners are nearby people outside this conversation who have a walkable path to you through the current doors. Consider their identities, hearing levels and your relationships before speaking about internal affairs or secret plans. The current conversation is not automatically private: use the supplied current room and listener list, not the interface framing, to judge privacy. meetingPoints contains only named destinations that every participant is permitted to enter and can reach by legal movement, including opening permitted doors; private marks the destinations intended for private meetings. You may be guarded, use indirect language, withhold details, or ask the other participant to move to a named private meeting point when your motives warrant it. If you propose relocating, do not reveal the sensitive details first, assume agreement, or claim anyone has moved. Conclude the current exchange when movement is needed; each character must then move and open any necessary doors through physical actions before the private discussion begins. An empty listener list means no eligible listeners at these positions, not a permanent guarantee of privacy. An empty meetingPoints list means there is no valid shared destination. Speech cannot close a door or move anyone.`;
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

export const CLEAR_EARSHOT_DISTANCE = 3;
export const MODERATE_EARSHOT_DISTANCE = 6;
export const EARSHOT_DISTANCE = 10;
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
      level: character.distance <= CLEAR_EARSHOT_DISTANCE ? "Clear"
        : character.distance <= MODERATE_EARSHOT_DISTANCE ? "Moderate" : "Distant",
    }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}
