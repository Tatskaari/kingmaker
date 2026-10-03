import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { CharacterSources } from "./conversation.js";

/** Explicit eager loading for the prototype. No recursive links or disclosure policy yet. */
export function loadCharacterSources(root: string, scenario: string, characterId: string): CharacterSources {
  const read = (path: string) => {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(resolve(root) + sep)) throw new Error("Lore path must stay inside the vault.");
    return readFileSync(absolute, "utf8");
  };
  const directory = `Scenarios/${scenario}/Characters/${characterId}`;
  const entry = read(`${directory}/character.md`);
  const castPath = entry.match(/\[\[(Cast\/[^|\]#]+)(?:\|[^\]]+)?\]\]/)?.[1];
  if (!castPath) throw new Error(`No Cast reference in ${directory}/character.md`);
  return {
    cast: read(`${castPath}.md`),
    scenario: ["character", "background", "situation", "conversation"]
      .map(name => `## ${directory}/${name}.md\n${name === "character" ? entry : read(`${directory}/${name}.md`)}`).join("\n\n"),
  };
}
