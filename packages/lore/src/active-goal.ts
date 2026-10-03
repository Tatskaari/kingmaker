import type { ScenarioInfo } from "./services.js";

export function characterEntry(info: Pick<ScenarioInfo, "characters">, characterId: string): string {
  const entry = info.characters.find(path => path.endsWith(`/Characters/${characterId}/character.md`));
  if (!entry) throw new Error(`Unknown scenario character: ${characterId}`);
  return entry;
}
