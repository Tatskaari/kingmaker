import { renderPrompt } from "../../prompts/src/index.js";
import { CHARACTER_PROMPT, type Complete } from "./conversation.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { RuntimeServices } from "./services.js";

const arrestTool: OpenRouterTool = { type: "function", function: {
  name: "arrest",
  description: renderPrompt("conversation-actions-arrest-tool"),
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} };

/** The DM decides the action; the character only voices the resulting ruling.
 * The host commits staged effects with a successful reply and persisted transcript. */
export function arrestResponse(services: Pick<RuntimeServices, "ai" | "agents">, characterId: string,
  stageArrest: (ruling: string) => void,
  defense: { outcome: () => "unheard" | "passed" | "failed"; challenge: () => void }): Complete {
  return async (request, signal = new AbortController().signal) => {
    const speak = (ruling?: string) => {
      const plain = { ...request };
      delete plain.tools;
      return services.ai.responses({ ...plain, reasoning: { effort: "none" },
        messages: [...request.messages, ...(ruling ? [{ role: "system" as const, content: ruling }] : [])],
      }, signal);
    };
    if (defense.outcome() === "passed") return speak(renderPrompt("conversation-actions-defense-passed"));
    const messages = await services.agents.prepare({ agent: "game_master", characterId, participantIds: [characterId, "player"],
      messages: request.messages.filter(message => message.content !== CHARACTER_PROMPT),
    }, signal);
    const decision = await services.ai.responses({ ...request, tools: [arrestTool], messages: [...messages,
      { role: "system", content: "Decide as the DM whether this guard should use the arrest action now, respecting the conversation, the guard's permitted knowledge and binding rulings. Call arrest if warranted; otherwise return no tool calls. Do not generate the character's dialogue; a separate fast character response will voice the result." },
    ] }, signal, { purpose: "gm_consultation", characterId });
    signal.throwIfAborted();
    if (!decision.tool_calls?.length) return speak();
    const [call] = decision.tool_calls;
    if (decision.tool_calls.length !== 1 || call!.function.name !== "arrest") throw new Error("Invalid DM arrest tool call.");
    const args: unknown = JSON.parse(call!.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("arrest expects empty arguments.");
    if (defense.outcome() === "unheard") {
      defense.challenge();
      return speak(renderPrompt("conversation-actions-challenge"));
    }
    const ruling = renderPrompt("conversation-actions-ruling");
    stageArrest(ruling);
    return speak(ruling);
  };
}
