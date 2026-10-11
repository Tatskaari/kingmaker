import { renderPrompt } from "../../prompts/src/index.js";
import { PRESENTATION_GUIDANCE } from "../../lore/src/presentation.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { CharacterSources } from "./conversation.js";
import type { LoreService, RuntimeServices } from "./services.js";

export const CHARACTER_PROMPT = renderPrompt("agent-setup-character_prompt");

export const GAME_MASTER_PROMPT = renderPrompt("agent-setup-game_master_prompt", { PRESENTATION_GUIDANCE: PRESENTATION_GUIDANCE });


export function characterMessages(sources: CharacterSources): OpenRouterMessage[] {
  return [{ role: "system", content: CHARACTER_PROMPT },
    ...sources.map(doc => ({ role: "system" as const, content: renderPrompt("lore-context", { path: doc.path, markdown: doc.markdown }) }))];
}

export interface AgentSetupContext {
  agent: "character" | "game_master" | "exchange" | "planner" | "wait" | "attention" | "stranger";
  /** Host-owned instructions for a reviewer with a narrower responsibility. */
  systemPrompt?: string;
  characterId?: string;
  messages: readonly OpenRouterMessage[];
  /** Active speakers are not bystanders in the earshot warning. */
  participantIds?: readonly string[];
  /** Already scoped by the host; never widen this source's permissions. */
  lore?: LoreService;
  /** Dialogue hosts may already have loaded the initial scoped documents. */
  sources?: CharacterSources;
  /** Dialogue performs disclosure in its classify/resolve loop instead. */
  disclose?: boolean;
}
export type AgentSetupHook = (context: Readonly<AgentSetupContext>, signal: AbortSignal,
  services: RuntimeServices) => Promise<OpenRouterMessage[]>;

/** Default prompt policy, separate from model execution and transport. */
export const setupAgent: AgentSetupHook = async (context, signal, services) => {
  const prompt = context.systemPrompt ?? (context.agent === "character" ? CHARACTER_PROMPT
    : context.agent === "game_master" ? GAME_MASTER_PROMPT
    : context.agent === "exchange" ? renderPrompt("exchange-system") : undefined);
  const task = [...(prompt ? [{ role: "system" as const, content: prompt }] : []), ...context.messages];
  const lore = context.lore ?? (!context.sources && context.characterId && context.agent !== "game_master"
    ? await services.lore.forCharacter(context.characterId, signal) : undefined);
  const initial = (context.sources ?? lore?.initial)?.map(doc => ({ role: "system" as const, content: renderPrompt("lore-context", { path: doc.path, markdown: doc.markdown }) })) ?? [];
  const messages = context.agent === "character" ? [task[0]!, ...initial, ...task.slice(1)] : [...initial, ...task];
  const opened = lore && context.disclose
    ? await services.disclosure.disclose(lore, messages, signal, context.characterId ? { characterId: context.characterId } : {}) : [];
  signal.throwIfAborted();
  return context.agent === "character" ? [...messages, ...opened] : [...initial, ...opened, ...task];
};
