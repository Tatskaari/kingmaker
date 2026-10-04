import type { Complete } from "./conversation.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";

const arrestTool: OpenRouterTool = { type: "function", function: {
  name: "arrest",
  description: "Attempt to arrest the player. The first call opens a challenge: explain the accusation and invite the player to defend themselves. Only after their defense has failed a check can this action end the conversation and place them in jail. Use for a credible threat of violence, an admitted serious palace crime, a witnessed break-in to restricted palace quarters, or clear ongoing trouble after a warning. Respect binding check rulings. Confusion, cheek, questions about identical brothers and fourth-wall jokes are not crimes. Threats or mentions of jail alone do not execute an arrest.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} };

/** The character chooses the tool after disclosure/checks. The host commits its
 * staged effect only with a successful final reply and persisted transcript. */
export function arrestResponse(respond: Complete, stageArrest: (ruling: string) => void,
  defense: { outcome: () => "unheard" | "passed" | "failed"; challenge: () => void }): Complete {
  return async (request, signal) => {
    if (defense.outcome() === "passed") return respond({ ...request, tools: [], messages: [...request.messages,
      { role: "system", content: "The player successfully defended against this arrest. Do not arrest them for this incident. Honour the resolved check and let them go." }] }, signal);
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
        { role: "system", content: "You have stopped the player to challenge them, not jailed them. Briefly explain the accusation and explicitly invite their explanation or defense. Wait for their reply; it will receive a skill check. Do not narrate an arrest, imprisonment or their response." },
      ] }, signal);
    }
    const ruling = "# Binding DM ruling\nYour arrest action succeeds. The player is placed in jail and this conversation ends. Give a brief in-character arrest line; do not ask a follow-up question or offer an escape. The game will show the jail popup.";
    stageArrest(ruling);
    return respond({ ...request, tools: [], messages: [...request.messages, reply,
      { role: "tool", tool_call_id: call!.id, content: JSON.stringify({ arrested: true }) },
      { role: "system", content: ruling },
    ] }, signal);
  };
}
