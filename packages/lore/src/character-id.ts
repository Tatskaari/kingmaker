import type { WorldState } from "../../contracts/src/v2.js";

/** Resolve the current document entry convention without constructing a legacy character. */
export function characterId(path: string, world: Pick<WorldState, "player">): string {
  if (path === world.player) return "player";
  const id = /\/Characters\/([^/]+)\/character\.md$/.exec(path)?.[1];
  if (!id) throw new Error(`Invalid character entry: ${path}`);
  return id;
}

/** Active runtime bodies share authored documents but retain independent identities. */
export function characterDocuments(world: WorldState) {
  return Object.values(world.runtimeCharacters).map(({ id, document: path }) => {
    const document = world.docs[path];
    if (!document) throw new Error(`Missing character document: ${path}`);
    return { id, path, document };
  });
}
