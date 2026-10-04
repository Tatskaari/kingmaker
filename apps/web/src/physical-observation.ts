import type { worldForCharacter } from "../../../packages/core/src/physical-view.js";
import type { GameAction } from "../../../packages/core/src/actions.js";
import { fixtureName } from "../../../packages/core/src/fixtures.js";

/** Describe a prepared observer-visible map without loading narrative character context. */
export function physicalCharacterObservation(known: ReturnType<typeof worldForCharacter>, characterId: string, goal: string, actions: readonly GameAction[]) {
  const actor = known.actors.find(item => item.characterId === characterId);
  if (!actor?.position) throw new Error("Character is not placed in the palace.");
  return {
    characterId, revision: known.revision, goal,
    world: {
      location: { roomId: actor.roomId, room: known.rooms.find(room => room.id === actor.roomId)?.name, position: actor.position },
      rooms: known.rooms.map(({ id, name }) => ({ id, name })),
      doors: known.doors.map(({ id, name, roomIds, open }) => ({ id, name, roomIds, open })),
      nearbyCharacters: known.actors.filter(other => other.roomId === actor.roomId).map(({ characterId, position }) => ({ characterId, position })),
      inventory: known.objects.filter(item => item.locationId === characterId).map(({ id, name }) => ({ id, name })),
      furniture: known.fixtures.filter(item => item.roomId === actor.roomId).map(item => ({ id: item.id, name: fixtureName(item, characterId),
        open: item.open, ...(item.requiredKeyId ? { requiredKeyId: item.requiredKeyId } : {}),
        ...(item.open || item.searchedBy.includes(characterId) ? { contents: known.objects.filter(object => object.locationId === item.id).map(({ id, name }) => ({ id, name })) } : { contents: "Unknown until opened" }),
      })),
    },
    actions,
  };
}
export type PhysicalCharacterObservation = ReturnType<typeof physicalCharacterObservation>;
