import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { AgentSetupContext } from "./agent-setup.js";
import type { LoreService, RuntimeServices } from "./services.js";

/** Prepare scoped context through host policy before an agent decides or speaks. */
export function disclosedContext(agent: AgentSetupContext["agent"], context: readonly OpenRouterMessage[],
  services: Pick<RuntimeServices, "agents">, characterId: string, signal: AbortSignal, lore?: LoreService): Promise<OpenRouterMessage[]> {
  return services.agents.prepare({ agent, characterId, messages: context, disclose: true, ...(lore ? { lore } : {}) }, signal);
}
