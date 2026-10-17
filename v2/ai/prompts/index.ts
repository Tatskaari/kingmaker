import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The prompts' loader. Each prompt is a Markdown file in this folder (review/ has the memory
 * reviewers'), loaded by its name without the .md ("gm", "review/system") and sent as a call's
 * instructions; whatever changes from call to call is built in code and sent as the input.
 */

/** This folder: the static build writes where each module is into the bundle, and puts the prompts in content.json at the same path. */
const PROMPTS_DIR = import.meta.dirname;
const cache = new Map<string, string>();
/** A prompt by name. KM_PROMPTS_DIR tries another folder first (a variant to compare in the evals). */
export function prompt(name: string, vars: Record<string, string> = {}): string {
  let text = cache.get(name);
  if (text === undefined) {
    const variant = process.env.KM_PROMPTS_DIR ? join(process.env.KM_PROMPTS_DIR, `${name}.md`) : undefined;
    text = readFileSync(variant && existsSync(variant) ? variant : join(PROMPTS_DIR, `${name}.md`), "utf8").trim();
    cache.set(name, text);
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "").replace(/\n{3,}/g, "\n\n");
}
