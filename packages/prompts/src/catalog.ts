import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseMarkdown } from "../../lore/src/markdown.js";

/** Relative template paths, excluding author navigation indexes at every depth. */
export function listPromptFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.isDirectory()) return listPromptFiles(new URL(`${entry.name}/`, directory)).map(path => `${entry.name}/${path}`);
    return entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md" ? [entry.name] : [];
  });
}

/** The browser build uses this same reader to bundle the authored Markdown bodies. */
export function readPromptCatalog(directory: URL): Record<string, string> {
  const paths = new Map<string, string>();
  return Object.fromEntries(listPromptFiles(directory).map(path => {
    const id = basename(path, ".md");
    if (paths.has(id)) throw new Error(`Duplicate prompt ID: ${id} (${paths.get(id)}, ${path})`);
    paths.set(id, path);
    const note = parseMarkdown(readFileSync(new URL(path, directory), "utf8"));
    if (note.error || note.metadata.visibility !== "gm" || typeof note.metadata.summary !== "string" || !note.metadata.summary.trim() || !note.body.trim()) {
      throw new Error(`Invalid prompt Markdown: ${path}${note.error ? `: ${note.error}` : ""}`);
    }
    // Folders organise authorship; the filename remains the runtime ID.
    // Remove only the file's final newline, preserving intentional prompt whitespace.
    return [id, note.body.replace(/\r\n/g, "\n").replace(/\n$/, "")];
  }));
}

export default readPromptCatalog(new URL("../../../lore/gm_prompts/", import.meta.url));
