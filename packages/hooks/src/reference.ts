import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import { DocumentSchema, type Document } from "../../contracts/src/v2.js";
import { parseMarkdown } from "../../lore/src/markdown.js";
import catalog from "./reference-catalog.js";

export const hookReferenceRoot = "docs/hooks";
/** Replace only build-owned reference documents, including on current-format save loading. */
export function withHookReference(docs: Record<string, Document>): Record<string, Document> {
  const result = Object.fromEntries(Object.entries(docs).filter(([path]) => path !== hookReferenceRoot && !path.startsWith(`${hookReferenceRoot}/`)));
  for (const [path, text] of Object.entries(catalog)) {
    const note = parseMarkdown(text);
    if (note.error || note.metadata.visibility !== "gm") throw new Error(`${path}: invalid hook reference`);
    result[path] = fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
  }
  return result;
}
