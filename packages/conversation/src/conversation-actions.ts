import type { Complete } from "./conversation.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";

const arrestTool: OpenRouterTool = { type: "function", function: {
  name: "arrest",
  description: "Arrest the player now, ending this conversation and placing them in jail. Use for a credible threat of violence, an admitted serious palace crime, or clear ongoing trouble after a warning. Respect binding check rulings. Confusion, cheek, questions about identical brothers and fourth-wall jokes are not crimes. Threats or mentions of jail alone do not execute an arrest.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} };

/** The character chooses the tool after disclosure/checks. The host commits its
 * staged effect only with a successful final reply and persisted transcript. */
export function arrestResponse(respond: Complete, stageArrest: (ruling: string) => void): Complete {
  return async (request, signal) => {
    const reply = await respond({ ...request, tools: [arrestTool] }, signal);
    signal?.throwIfAborted();
    if (!reply.tool_calls?.length) return reply;
    const [call] = reply.tool_calls;
    if (reply.tool_calls.length !== 1 || call!.function.name !== "arrest") throw new Error("Invalid conversation tool call.");
    const args: unknown = JSON.parse(call!.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("arrest expects empty arguments.");
    const ruling = "# Binding DM ruling\nYour arrest action succeeds. The player is placed in jail and this conversation ends. Give a brief in-character arrest line; do not ask a follow-up question or offer an escape. The game will show the jail popup.";
    stageArrest(ruling);
    return respond({ ...request, tools: [], messages: [...request.messages, reply,
      { role: "tool", tool_call_id: call!.id, content: JSON.stringify({ arrested: true }) },
      { role: "system", content: ruling },
    ] }, signal);
  };
}
