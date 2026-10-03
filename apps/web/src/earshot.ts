import { courtPath, courtRoomAt } from "./court-map.js";
import { palaceNodes } from "./palace-navigation.js";
import { doorActionLegality } from "../../../packages/core/src/access.js";
import type { DoorState, MapFixture, Scenario } from "../../../packages/contracts/src/index.js";

export function dialogueEarshotPrompt(
  scenario: Scenario,
  speakerId: string,
  participantIds: readonly string[],
  explicit?: { withinEarshot: readonly string[] },
): string {
  const world = scenario.world;
  const characters = scenario.characters.flatMap(character => (world?.actors.filter(actor => actor.characterId === character.id) ?? [])
    .map(actor => ({ id: character.id, name: character.name, position: actor.position })));
  const speaker = characters.find(character => character.id === speakerId);
  const speakerActor = world?.actors.find(actor => actor.characterId === speakerId);
  const currentRoom = world?.rooms.find(room => room.id === speakerActor?.roomId);
  const participantActors = participantIds.map(characterId => world?.actors.find(actor => actor.characterId === characterId));
  const meetingPoints = !explicit && world && participantActors.every(actor => actor?.position) ? palaceNodes.flatMap(node => {
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
  const listeners = explicit === undefined
    ? (speaker ? courtCharactersWithinEarshot(speaker, characters.filter(character => !participantIds.includes(character.id)), world?.doors, world?.fixtures)
      .map(({ id, name, distance, level }) => ({ characterId: id, name, distance, level })) : [])
    : explicit.withinEarshot.map(characterId => {
      const character = characters.find(item => item.id === characterId);
      if (!character) throw new Error(`Cannot add unknown character ${characterId} to earshot`);
      if (participantIds.includes(characterId)) throw new Error(`Conversation participant ${characterId} cannot also be within_earshot`);
      return { characterId, name: character.name, level: "Moderate" as const };
    });
  const listenerGroups = (Object.keys(EARSHOT_DESCRIPTIONS) as EarshotCharacter["level"][]).flatMap(level => {
    const group = listeners.filter(listener => listener.level === level);
    if (!group.length) return [];
    return [`${EARSHOT_DESCRIPTIONS[level]}\n${group.map(listener => `- ${listener.name} (${listener.characterId})`).join("\n")}`];
  }).join("\n\n") || "No other characters are within earshot at your current positions.";
  return `# Conversation privacy\n${JSON.stringify({ positionKnown: explicit ? false : !!speaker?.position,
    currentRoom: currentRoom ? { roomId: currentRoom.id, name: currentRoom.name, private: currentRoom.private } : null,
    meetingPoints,
  })}\n\n${listenerGroups}\n\nThe listeners are nearby people outside this conversation who have a walkable path to you through the current doors. Consider their identities, hearing levels and your relationships before speaking about internal affairs or secret plans. The current conversation is not automatically private: use the supplied current room and listener list, not the interface framing, to judge privacy. meetingPoints contains only named destinations that every participant is permitted to enter and can reach by legal movement, including opening permitted doors; private marks the destinations intended for private meetings. You may be guarded, use indirect language, withhold details, or ask the other participant to move to a named private meeting point when your motives warrant it. If you propose relocating, do not reveal the sensitive details first, assume agreement, or claim anyone has moved. If you want to speak privately, tell the player as such and end the conversation. You will be able to move there after that. Each character must then move and open any necessary doors through physical actions before the private discussion begins. An empty listener list means no eligible listeners at these positions, not a permanent guarantee of privacy. An empty meetingPoints list means there is no valid shared destination. Speech cannot close a door or move anyone.`;
}

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
  Clear: "These characters are right by you and will almost certainly hear what you say.",
  Moderate: "These characters are nearby. They will likely catch names, places and parts of what you say, but there will be gaps.",
  Distant: "These characters are farther away. They may catch the odd name or place, but are unlikely to follow the details of what you say.",
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
