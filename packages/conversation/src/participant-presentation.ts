import { renderPrompt } from "../../prompts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { presentationPath } from "../../lore/src/presentation.js";

export const PRESENTATIONS_PREFIX = "# Current participant appearances";

/** Intentionally coarse perceived power, not a disclosure of scores or combat outcomes. */
export function relativePower(subjectLevel: number, observerLevel: number): string {
  if (subjectLevel < 1 || observerLevel < 1) return "Their relative power is unclear.";
  const difference = subjectLevel - observerLevel;
  if (difference >= 6) return "They look far more formidable than you.";
  if (difference >= 3) return "They look more formidable than you.";
  if (difference <= -6) return "They look far less formidable than you.";
  if (difference <= -3) return "They look less formidable than you.";
  return "They look roughly as formidable as you.";
}

/** Only explicitly public appearance crosses the participant boundary; never private lore. */
export function participantPresentations(world: WorldState, observerId: string, participantIds: readonly string[]): OpenRouterMessage[] {
  const entry = (id: string) => id === "player" ? world.player : world.runtimeCharacters[id]?.document;
  const observer = world.docs[entry(observerId) ?? ""];
  const level = (path: string | undefined) => world.docs[path ?? ""]?.characterProperties?.dnd?.classes.reduce((sum, item) => sum + item.level, 0) ?? 0;
  if (!observer) return [];
  const descriptions = [...new Set(participantIds)].filter(id => id !== observerId).flatMap(id => {
    const path = entry(id), doc = world.docs[path ?? ""];
    if (!doc || !path) return [];
    const stats = doc.characterProperties?.dnd;
    const name = typeof doc.frontmatter?.name === "string" ? doc.frontmatter.name : id;
    const className = stats?.classes.map(item => item.classId.replaceAll("-", " ")).filter(Boolean).join("/");
    const species = stats?.speciesId.replaceAll("-", " ");
    const identity = className && species ? `a ${className} ${species}` : className ? `a ${className}` : species ? `a ${species}` : "a person of unknown class and species";
    const presentation = world.docs[presentationPath(path)];
    const appearance = presentation?.frontmatter?.visibility === "public" ? presentation.body : "Their appearance has not been described.";
    return [`Before you stands ${name}, ${identity}. ${relativePower(level(path), level(entry(observerId)))}\n\n${appearance}`];
  });
  return descriptions.length ? [{ role: "system", content: renderPrompt("participant-presentation-1", { PRESENTATIONS_PREFIX: PRESENTATIONS_PREFIX, value2: descriptions.join("\n\n") }) }] : [];
}
