import { readdirSync, readFileSync } from "node:fs";
/** Baseline hook sources, copied into documents only when constructing a fresh world. */
export function readHookSources(directory = new URL("../../../content/hooks/", import.meta.url)): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).filter(name => name.endsWith(".ts")).sort().map(name => [`Hooks/${name}`, readFileSync(new URL(name, directory), "utf8")]));
}
export default readHookSources();
