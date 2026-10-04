import { renderPrompt } from "../../prompts/src/index.js";
import { toJson } from "@bufbuild/protobuf";
import { GamePhase, ItemInstanceSchema, type WorldState } from "../../contracts/src/index.js";
import type { locatedItems } from "./inventory.js";

type WorldView = WorldState & { objects: ReturnType<typeof locatedItems> };

/** A narrative view, not an executable map or replacement save. Callers must apply
 * character visibility before rendering; omitting characterId is for the GM only. */
export function renderWorldPrompt(characters: readonly { id: string; name: string }[], view: WorldView, characterId?: string): string {
  const actor = view.actors.find(item => item.characterId === characterId);
  const fixtures = view.fixtures.filter(item => !characterId || item.roomId === actor?.roomId
    || item.ownerCharacterId === characterId || item.examinedBy.includes(characterId)
    || item.searchedBy.includes(characterId) || view.objects.some(object => object.locationId === item.id));
  const name = (id: string) => characters.find(item => item.id === id)?.name ?? id;
  const lines = [
    `Day ${view.day}; phase ${GamePhase[view.phase]}; revision ${view.revision}.`,
    ...(characterId ? [renderPrompt("world-prompt-1", { value1: actor?.roomId || "Not placed" })] : []),
    renderPrompt("world-prompt-2"),
    "Rooms (id, name, description, exits, privacy and access):",
    ...view.rooms.map(room => JSON.stringify({ id: room.id, name: room.name, description: room.description,
      exits: room.exitRoomIds, ...(room.private ? { private: true } : {}),
      ...(room.allowedCharacterIds.length ? { allowedCharacters: room.allowedCharacterIds } : {}) })),
    "Characters (id, name, room, home, awake):",
    ...view.actors.map(item => JSON.stringify([item.characterId, name(item.characterId), item.roomId, item.homeRoomId, item.awake])),
    "Doors (id, name, connecting rooms, state):",
    ...view.doors.map(item => JSON.stringify([item.id, item.name, item.roomIds, item.open ? "open" : "closed"])),
    "Furniture (id, name, room, owner and known container state):",
    ...fixtures.map(item => JSON.stringify({ id: item.id, name: item.revealedName || item.name, room: item.roomId,
      ...(item.ownerCharacterId ? { owner: item.ownerCharacterId } : {}),
      ...(item.container ? { state: item.open ? "open" : "closed",
        ...(item.requiredKeyId ? { requiredKey: item.requiredKeyId } : {}),
        contentsKnown: !characterId || item.open || item.searchedBy.includes(characterId) } : {}) })),
    renderPrompt("world-prompt-3"),
    ...view.objects.map(item => JSON.stringify({ ...toJson(ItemInstanceSchema, item) as object, locationId: item.locationId })),
    `Established facts: ${JSON.stringify(view.facts ?? {})}`,
  ];
  return lines.join("\n");
}
