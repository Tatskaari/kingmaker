import type { JevClient } from "../../providers/src/jev.js";
import type { OpenRouterClient } from "../../providers/src/openrouter.js";
import type { CharacterLore } from "./lore.js";
import type { AiService, LoreService } from "./services.js";
import { retryResponses } from "./ai.js";

export function aiService(responses: Pick<OpenRouterClient, "complete">, decisions: Pick<JevClient, "evaluate">, retry = true): AiService {
  const respond: AiService["responses"] = (request, signal, info) => responses.complete(request, signal, undefined, info?.onText);
  return {
    responses: retry ? retryResponses(respond) : respond,
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

/** Compatibility surface for classifiers; transport still goes through AiService. */
export function decisionClient(ai: AiService): Pick<JevClient, "evaluate" | "choose"> {
  return {
    evaluate: (state, questions, signal) => ai.decisions(state, questions, signal),
    choose: async (state, instructions, criteria, signal) =>
      (await ai.decisions(state, { next: { type: "choice", instructions, criteria } }, signal)).next!,
  };
}
