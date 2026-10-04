import { renderPrompt } from "../../prompts/src/index.js";
import type { Complete } from "./conversation.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";

const arrestTool: OpenRouterTool = { type: "function", function: {
  name: "arrest",
  description: renderPrompt("conversation-actions-arrest-tool"),
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} };

/** The character chooses the tool after disclosure/checks. The host commits its
 * staged effect only with a successful final reply and persisted transcript. */
export function arrestResponse(respond: Complete, stageArrest: (ruling: string) => void,
  defense: { outcome: () => "unheard" | "passed" | "failed"; challenge: () => void }): Complete {
  return async (request, signal) => {
    if (defense.outcome() === "passed") return respond({ ...request, tools: [], messages: [...request.messages,
      { role: "system", content: renderPrompt("conversation-actions-defense-passed") }] }, signal);
    const reply = await respond({ ...request, tools: [arrestTool] }, signal);
    signal?.throwIfAborted();
    if (!reply.tool_calls?.length) return reply;
    const [call] = reply.tool_calls;
    if (reply.tool_calls.length !== 1 || call!.function.name !== "arrest") throw new Error("Invalid conversation tool call.");
    const args: unknown = JSON.parse(call!.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("arrest expects empty arguments.");
    if (defense.outcome() === "unheard") {
      defense.challenge();
      return respond({ ...request, tools: [], messages: [...request.messages, reply,
        { role: "tool", tool_call_id: call!.id, content: JSON.stringify({ arrested: false, defenseRequired: true }) },
        { role: "system", content: renderPrompt("conversation-actions-challenge") },
      ] }, signal);
    }
    const ruling = renderPrompt("conversation-actions-ruling");
    stageArrest(ruling);
    return respond({ ...request, tools: [], messages: [...request.messages, reply,
      { role: "tool", tool_call_id: call!.id, content: JSON.stringify({ arrested: true }) },
      { role: "system", content: ruling },
    ] }, signal);
  };
}
