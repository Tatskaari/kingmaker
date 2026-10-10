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
  const entry = (id: string) => id === "player" ? world.player : world.simulation!.runtimeCharacters[id]?.document;
  const observer = world.docs[entry(observerId) ?? ""];
  const level = (id: string) => world.simulation!.runtimeCharacters[id]?.dnd?.classes.reduce((sum, item) => sum + item.level, 0) ?? 0;
  if (!observer) return [];
  const descriptions = [...new Set(participantIds)].filter(id => id !== observerId).flatMap(id => {
    const path = entry(id), doc = world.docs[path ?? ""];
    if (!doc || !path) return [];
    const stats = world.simulation!.runtimeCharacters[id]?.dnd;
    const name = typeof doc.frontmatter?.name === "string" ? doc.frontmatter.name : id;
    const className = stats?.classes.map(item => item.classId.replaceAll("-", " ")).filter(Boolean).join("/");
    const species = stats?.speciesId.replaceAll("-", " ");
    const identity = className && species ? `a ${className} ${species}` : className ? `a ${className}` : species ? `a ${species}` : "a person of unknown class and species";
    const presentation = world.docs[presentationPath(path)];
    const form = world.simulation!.map?.actors.find(actor => actor.characterId === id)?.physicalForm;
    const appearance = form === "cow" ? "A rather overweight, ugly cow. They can still speak." : presentation?.frontmatter?.visibility === "public" ? presentation.body : "Their appearance has not been described.";
    return [`Before you stands ${name}, ${form === "cow" ? "currently in cow form" : identity}. ${relativePower(level(id), level(observerId))}\n\n${appearance}`];
  });
  return descriptions.length ? [{ role: "system", content: renderPrompt("participant-presentations", { PRESENTATIONS_PREFIX: PRESENTATIONS_PREFIX, appearances: descriptions.join("\n\n") }) }] : [];
}
