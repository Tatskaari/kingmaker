import { readdirSync, readFileSync } from "node:fs";

/** Shared Node/build reader; Vite replaces this module with the same static catalog. */
export function readHookReference(directory = new URL("../../../docs/hooks/", import.meta.url), prefix = "docs/hooks/"): Record<string, string> {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.isDirectory()) return Object.entries(readHookReference(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`));
    return entry.name.endsWith(".md") ? [[`${prefix}${entry.name}`, readFileSync(new URL(entry.name, directory), "utf8")]] : [];
  }));
}
export default readHookReference();
