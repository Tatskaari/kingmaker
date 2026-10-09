import { saveMemory, type MemoryInput } from "../../lore/src/memories.js";
import { DocumentConflictError } from "../../lore/src/services.js";
import { parseModelObject } from "../../providers/src/structured-output.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { Complete } from "./conversation.js";
import type { RuntimeServices } from "./services.js";

export const memoryTool: OpenRouterTool = { type: "function", function: {
  name: "save_memory",
  description: "Save a durable private memory for yourself. Record only what you have experienced, learned, or believe; distinguish claims from facts. Use a short title, one or two sentences describing when/why you recorded it, and the actual memory content. Memories are indexed for later recall. Avoid saving the same memory repeatedly.",
  parameters: { type: "object", additionalProperties: false, required: ["title", "context", "content"], properties: {
    title: { type: "string", description: "What this memory is about in a few words." },
    context: { type: "string", description: "One or two sentences describing the context in which this memory was recorded." },
    content: { type: "string", description: "The actual content of the memory." },
  } },
} };

/** Like document tools, each successful save commits immediately, before the next model call. */
export function memoryResponse(respond: Complete, services: Pick<RuntimeServices, "docs" | "scenario" | "debug">, characterId: string): Complete {
  return async (request, signal) => {
    const messages = [...request.messages];
    for (let turn = 0; turn < 16; turn++) {
      signal?.throwIfAborted();
      const response = await respond({ ...request, messages, tools: [...(request.tools ?? []), memoryTool] }, signal);
      signal?.throwIfAborted();
      if (!response.tool_calls?.some(call => call.function.name === "save_memory")) return response;
      messages.push(response);
      for (const call of response.tool_calls) {
        let result: Record<string, unknown>;
        try {
          signal?.throwIfAborted();
          if (call.function.name !== "save_memory") throw new Error("Call this action again in a separate round after saving your memories.");
          const input = parseModelObject(call.function.arguments, "Save memory");
          const saved = await saveMemory(services, characterId, input as unknown as MemoryInput);
          result = { ok: true, ...saved };
          for (const path of [saved.path, saved.index]) services.debug.documentUpdated?.({
            path, beforeSha: "", afterSha: (await services.docs.read(path)).sha, response, toolCallId: call.id,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          result = { ok: false, error: error instanceof DocumentConflictError ? "document_conflict" : "memory_error",
            message: error instanceof Error ? error.message : String(error) };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    throw new Error("Memory tool limit reached; conversation incomplete.");
  };
}
