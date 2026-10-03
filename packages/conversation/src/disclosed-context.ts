import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { LoreService, RuntimeServices } from "./services.js";

/** Complete retrieval before an agent decides, speaks or publishes effects. */
export async function disclosedContext(lore: LoreService, context: readonly OpenRouterMessage[],
  services: Pick<RuntimeServices, "disclosure">, characterId: string, signal: AbortSignal): Promise<OpenRouterMessage[]> {
  const initial = lore.initial.map(doc => ({ role: "system" as const, content: `# Lore: ${doc.path}\n${doc.markdown}` }));
  const opened = await services.disclosure.disclose(lore, [...initial, ...context], signal, { characterId });
  signal.throwIfAborted();
  return [...initial, ...opened, ...context];
}
