import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { CharacterSources } from "./conversation.js";

/** Explicit eager loading for the prototype. No recursive links or disclosure policy yet. */
export function loadCharacterSources(root: string, scenario: string, characterId: string): CharacterSources {
  const vaultPath = (path: string) => {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(resolve(root) + sep)) throw new Error("Lore path must stay inside the vault.");
    return absolute;
  };
  const read = (path: string) => readFileSync(vaultPath(path), "utf8");
  const directory = `Scenarios/${scenario}/Characters/${characterId}`;
  const entry = read(`${directory}/character.md`);
  const castPath = entry.match(/\[\[(Cast\/[^|\]#]+\/private)(?:\|[^\]]+)?\]\]/)?.[1];
  if (!castPath) throw new Error(`No private Cast reference in ${directory}/character.md`);
  const knowledgeDirectory = `${dirname(castPath)}/knowledge`;
  const knowledgePaths = readdirSync(vaultPath(knowledgeDirectory), { withFileTypes: true })
    .filter(file => file.isFile() && file.name.endsWith(".md") && file.name !== "index.md")
    .map(file => `${knowledgeDirectory}/${file.name}`).sort();
  return {
    cast: read(`${castPath}.md`),
    knowledge: knowledgePaths.map(path => `## ${path}\n${read(path)}`).join("\n\n"),
    scenario: ["character", "background", "situation", "conversation"]
      .map(name => `## ${directory}/${name}.md\n${name === "character" ? entry : read(`${directory}/${name}.md`)}`).join("\n\n"),
  };
}
