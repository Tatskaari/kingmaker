import { saveMemory, type MemoryInput } from "../../lore/src/memories.js";
import { DocumentConflictError } from "../../lore/src/services.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { DocumentUpdate, RuntimeServices } from "./services.js";

export const memoryTool: OpenRouterTool = { type: "function", function: {
  name: "save_memory",
  description: "Save a durable private memory for a character based only on what they experienced, learned, or believe. Distinguish claims from facts. Use this tool for new memories: it creates a separate note and adds its title/context link to the index. Do not write the memory body into an index or character entry. Avoid duplicate memories. Omit characterId to use the current review/ruling's character; otherwise supply the target runtime character ID.",
  parameters: { type: "object", additionalProperties: false, required: ["title", "context", "content"], properties: {
    characterId: { type: "string", description: "Optional target character; defaults to the current review/ruling's character." },
    title: { type: "string", description: "What this memory is about in a few words." },
    context: { type: "string", description: "One or two sentences describing the context in which this memory was recorded." },
    content: { type: "string", description: "The actual content of the memory from this character's perspective." },
  } },
} };

/** GM document effects commit immediately through the shared atomic document service. */
export async function callMemoryTool(services: Pick<RuntimeServices, "docs" | "scenario" | "debug">,
  defaultCharacterId: string | undefined, input: Record<string, unknown>, trace?: Pick<DocumentUpdate, "response" | "toolCallId">) {
  try {
    const { characterId = defaultCharacterId, ...memory } = input;
    if (typeof characterId !== "string" || !characterId.trim()) throw new Error("Supply characterId for the memory's owner.");
    const saved = await saveMemory(services, characterId, memory as unknown as MemoryInput);
    const before = saved.beforeIndex;
    if (trace) for (const path of [saved.path, saved.index]) {
      const after = await services.docs.read(path);
      services.debug.documentUpdated?.({ path, beforeSha: path === before.path ? before.sha : "", afterSha: after.sha,
        beforeText: path === before.path ? before.text : "", afterText: after.text, ...trace });
    }
    return { ok: true, path: saved.path, index: saved.index };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { ok: false, error: error instanceof DocumentConflictError ? "document_conflict" : "memory_error",
      message: error instanceof Error ? error.message : String(error) };
  }
}
