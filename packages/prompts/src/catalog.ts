import { readdirSync, readFileSync } from "node:fs";
import { parseMarkdown } from "../../lore/src/markdown.js";

/** The browser build uses this same reader to bundle the authored Markdown bodies. */
export function readPromptCatalog(directory: URL): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).sort().filter(name => name.endsWith(".md") && name !== "index.md").map(name => {
    const note = parseMarkdown(readFileSync(new URL(name, directory), "utf8"));
    if (note.error || note.metadata.visibility !== "gm" || typeof note.metadata.summary !== "string" || !note.metadata.summary.trim() || !note.body.trim()) {
      throw new Error(`Invalid prompt Markdown: ${name}${note.error ? `: ${note.error}` : ""}`);
    }
    // Remove only the file's final newline, preserving intentional prompt whitespace.
    return [name.slice(0, -3), note.body.replace(/\r\n/g, "\n").replace(/\n$/, "")];
  }));
}

export default readPromptCatalog(new URL("../../../lore/gm_prompts/", import.meta.url));
