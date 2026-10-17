import { folderVolume } from "../docs/volumes.ts";

/**
 * The prompts' loader. Each prompt is a Markdown file in this folder (review/ has the memory
 * reviewers'), loaded by its name without the .md ("gm", "review/system") and sent as a call's
 * instructions; whatever changes from call to call is built in code and sent as the input.
 *
 * Where the words come from is a source, which a host gives once, before the first prompt
 * (configurePrompts: the page's are in its content.json). Until one does, it's this folder, read
 * when a prompt is first asked for (folderPrompts), so importing this asks nothing of a file system.
 */

/** A prompt's words by its name ("gm", "review/system"), or undefined when there's none of that name. */
export type PromptSource = (name: string) => string | undefined;

let source: PromptSource | undefined;
const cache = new Map<string, string>();

/** Where the prompts come from, from now on: those already read are read again from it. */
export function configurePrompts(next: PromptSource): void {
  source = next;
  cache.clear();
}

/** A prompt by name, its {{vars}} filled in. */
export function prompt(name: string, vars: Record<string, string> = {}): string {
  let text = cache.get(name);
  if (text === undefined) {
    const found = (source ??= folderPrompts())(name);
    if (found === undefined) throw new Error(`there's no prompt named ${name}`);
    text = found.trim();
    cache.set(name, text);
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "").replace(/\n{3,}/g, "\n\n");
}

/**
 * The prompts in a folder, this one unless another is named. KM_PROMPTS_DIR tries another folder
 * first (a variant to compare in the evals). The static build writes where each module is into the
 * bundle, and puts the prompts in content.json at the same path.
 */
export function folderPrompts(dir: string = import.meta.dirname): PromptSource {
  const here = folderVolume(dir);
  return name => {
    const variants = globalThis.process?.env.KM_PROMPTS_DIR;
    return (variants ? folderVolume(variants).read(`${name}.md`) : undefined) ?? here.read(`${name}.md`);
  };
}
