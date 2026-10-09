import type { WorldState } from "../../../packages/contracts/src/v2.js";

/** Guards may enter private rooms when responding to perceived trouble. */
export function grantGuardAccess(world: WorldState) {
  for (const character of Object.values(world.simulation!.runtimeCharacters)) {
    const entry = world.docs[character.document]!;
    if (!Array.isArray(entry.frontmatter?.conversation_actions) || !entry.frontmatter.conversation_actions.includes("arrest")) continue;
    const actor = world.simulation!.map!.actors.find(actor => actor.characterId === character.id);
    if (!actor?.position) continue;
    for (const room of world.simulation!.map!.rooms) if (room.private && !room.allowedCharacterIds.includes(character.id)) room.allowedCharacterIds.push(character.id);
  }
}
