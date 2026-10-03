import type { Document } from "../../contracts/src/v2.js";
import type { ScenarioInfo } from "./services.js";

export function characterEntry(info: ScenarioInfo, characterId: string): string {
  const entry = info.characters.find(path => path.endsWith(`/Characters/${characterId}/character.md`));
  if (!entry) throw new Error(`Unknown scenario character: ${characterId}`);
  return entry;
}

/** Mutable playthrough intent belongs to the scenario character document. */
export function activeGoal(document: Document): string | null {
  const goal = document.frontmatter?.active_goal;
  if (goal === undefined || goal === null) return null;
  if (typeof goal !== "string" || !goal.trim()) throw new Error("active_goal must be a non-empty string or null.");
  return goal;
}
