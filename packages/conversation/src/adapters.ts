import type { JevClient } from "../../providers/src/jev.js";
import type { OpenRouterClient } from "../../providers/src/openrouter.js";
import type { CharacterLore } from "./lore.js";
import type { AiService, LoreService } from "./services.js";

export function aiService(responses: Pick<OpenRouterClient, "complete">, decisions: Pick<JevClient, "evaluate">): AiService {
  return {
    responses: (request, signal) => responses.complete(request, signal),
    decisions: (state, questions, signal) => decisions.evaluate(state, questions, signal),
  };
}
export function loreService(lore: CharacterLore): LoreService {
  return {
    initial: lore.initial,
    links: sources => lore.candidates(sources),
    async open(link, signal) { signal.throwIfAborted(); return lore.read(link.path); },
  };
}
