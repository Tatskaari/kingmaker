import { renderPrompt } from "../../prompts/src/index.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import { DocumentConflictError, type DocsService } from "../../lore/src/services.js";
import { DocumentValidationError } from "../../lore/src/document-audit.js";

const string = { type: "string" };
function tool(name: string, description: string, properties: Record<string, unknown>): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: {
    type: "object", additionalProperties: false, required: Object.keys(properties), properties,
  } } };
}
const version = { path: string, expectedSha: string };
export const documentTools: OpenRouterTool[] = [
  tool("read_document", renderPrompt("document-tools-1"), { path: string }),
  tool("create_document", renderPrompt("document-tools-2"), { path: string, text: string }),
  tool("replace_document", renderPrompt("document-tools-3"), { ...version, oldText: string, newText: string }),
  tool("insert_document", renderPrompt("document-tools-4"), { ...version, afterLine: { type: "integer", minimum: 0 }, text: string }),
  tool("delete_document", renderPrompt("document-tools-5"), version),
];

/** Model arguments are untrusted even when a provider accepts strict schemas. */
export async function callDocumentTool(docs: DocsService, name: string, input: Record<string, unknown>) {
  const definition = documentTools.find(tool => tool.function.name === name);
  if (!definition) throw new Error(`Unknown document tool: ${name}`);
  try {
    const schema = definition.function.parameters as { properties: Record<string, { type: string }> };
    if (Object.keys(input).some(key => !(key in schema.properties))) throw new Error("Unexpected document tool argument.");
    for (const [key, property] of Object.entries(schema.properties)) {
      if (property.type === "integer" ? !Number.isInteger(input[key]) || (input[key] as number) < 0 : typeof input[key] !== "string") {
        throw new Error(`Invalid document tool argument: ${key}`);
      }
    }
    const path = input.path as string, sha = input.expectedSha as string;
    switch (name) {
      case "read_document": return { ok: true, current: await docs.read(path) };
      case "create_document": return { ok: true, current: await docs.create(path, input.text as string) };
      case "replace_document": return { ok: true, current: await docs.replace(path, sha, input.oldText as string, input.newText as string) };
      case "insert_document": return { ok: true, current: await docs.insert(path, sha, input.afterLine as number, input.text as string) };
      case "delete_document": await docs.delete(path, sha); return { ok: true, deleted: path };
      default: throw new Error(`Unknown document tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof DocumentConflictError) {
      return { ok: false, error: "document_conflict", current: await docs.read(error.path),
        instruction: renderPrompt("document-tools-6") };
    }
    return { ok: false, error: error instanceof DocumentValidationError ? "document_validation" : "document_error",
      message: error instanceof Error ? error.message : String(error) };
  }
}
