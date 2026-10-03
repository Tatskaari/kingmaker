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
  tool("read_document", "Read canonical Markdown (including YAML frontmatter) and its current SHA. Read before editing; preserve access metadata and unrelated content.", { path: string }),
  tool("create_document", "Create a new Markdown document. Include appropriate summary, visibility and readers in YAML frontmatter. Saves immediately after automatic validation.", { path: string, text: string }),
  tool("replace_document", "Replace text matching exactly once in canonical Markdown. Use the SHA from your latest read or edit. Saves immediately after automatic validation.", { ...version, oldText: string, newText: string }),
  tool("insert_document", "Insert text after a 1-based line of canonical Markdown; 0 inserts at the beginning. Use the latest SHA. Saves immediately after automatic validation.", { ...version, afterLine: { type: "integer", minimum: 0 }, text: string }),
  tool("delete_document", "Delete a document using its latest SHA. Saves immediately; automatic validation rejects dangling links and deletion of required documents. Remove references first.", version),
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
        instruction: "Nothing was written by this call. Reconcile with this refreshed document before retrying." };
    }
    return { ok: false, error: error instanceof DocumentValidationError ? "document_validation" : "document_error",
      message: error instanceof Error ? error.message : String(error) };
  }
}
