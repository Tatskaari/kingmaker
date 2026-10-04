import { create } from "@bufbuild/protobuf";
import { RuntimeCharacterSchema, type RuntimeCharacter, type WorldState } from "../../contracts/src/v2.js";

/** Explicit instance IDs are stable. A shared identity addresses the nearby interlocutor. */
export function runtimeActor(world: WorldState, id: string): RuntimeCharacter {
  const exact = world.runtimeCharacters[id];
  if (exact) return exact;
  const characters = Object.values(world.runtimeCharacters).filter(character => character.characterId === id);
  const player = world.map?.actors.find(actor => actor.characterId === "player")?.position;
  const distance = (character: RuntimeCharacter) => {
    const position = world.map?.actors.find(actor => (actor.instanceId ?? actor.characterId) === character.id)?.position;
    return player && position ? Math.abs(position.x - player.x) + Math.abs(position.y - player.y) : Infinity;
  };
  characters.sort((a, b) => distance(a) - distance(b));
  if (!characters[0]) throw new Error(`Unknown runtime character: ${id}`);
  return characters[0];
}

/** Scene defaults are copied once; restoring a save never calls this initializer. */
export function seedRuntimeCharacter(world: WorldState, id: string, characterId: string, document: string) {
  const metadata = world.docs[document]!.frontmatter ?? {};
  const path = (value: unknown) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !value.endsWith(".md") || value.includes("\\")
      || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Expected a vault-relative Markdown path.");
    return value;
  };
  world.runtimeCharacters[id] = create(RuntimeCharacterSchema, { id, characterId, document,
    activity: path(metadata.activity), wait: path(metadata.wait) });
}
