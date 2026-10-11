import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import { DocumentSchema, type Document } from "../../contracts/src/v2.js";
import { parseMarkdown } from "./markdown.js";
import { compileHook, type CompiledHook } from "../../hooks/src/compiler.js";
import { DocumentValidationError } from "./document-audit.js";

export const isHookPath = (path: string) => /^Hooks\/[a-z][a-z0-9-]*\.ts$/.test(path);
/** Source uses ordinary document tools but never Markdown parsing or character grants. */
export function parseDocument(path: string, text: string): Document {
  if (path.endsWith(".ts")) {
    if (!isHookPath(path)) throw new Error(`${path}: use Hooks/<name>.ts with a lowercase hyphenated name`);
    return fromJson(DocumentSchema, { body: text, frontmatter: { visibility: "gm", summary: `TypeScript conversation hook ${path}.` } });
  }
  const note = parseMarkdown(text);
  if (note.error) throw new Error(`${path}: ${note.error}`);
  return fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
}
/** Prepare a registry without modifying live documents or executing code. */
export function prepareHooks(docs: Readonly<Record<string, Document>>): ReadonlyMap<string, CompiledHook> {
  const hooks = new Map<string, CompiledHook>();
  for (const [path, doc] of Object.entries(docs)) {
    if (!path.endsWith(".ts")) continue;
    try {
      if (!isHookPath(path) || doc.frontmatter?.visibility !== "gm") throw new Error("Hooks require a Hooks/<name>.ts path and GM-only visibility");
      hooks.set(path.slice("Hooks/".length), compileHook(path, doc.body));
    } catch (error) { throw new DocumentValidationError([{ kind: "invalid", trail: [path], detail: String(error) }]); }
  }
  return hooks;
}
