import Mustache from "mustache";
import catalog from "../../../lore/gm_prompts/catalog.json" with { type: "json" };

export type PromptId = keyof typeof catalog;

/** Fail loudly on authoring mistakes instead of silently dropping runtime context. */
class PromptContext extends Mustache.Context {
  override lookup(name: string): unknown {
    const value: unknown = super.lookup(name);
    if (value === undefined) throw new Error(`Missing prompt variable: ${name}`);
    if (typeof value === "function") throw new Error(`Prompt variables cannot execute functions: ${name}`);
    return value;
  }
  override push(view: unknown): PromptContext { return new PromptContext(view, this); }
}

/** Trusted templates; callers supply already permission-filtered evidence as plain text. */
export function renderPrompt(id: PromptId, values: Record<string, unknown> = {}): string {
  const entry = catalog[id];
  if (!entry) throw new Error(`Unknown prompt: ${id}`);
  return Mustache.render(entry.template.join("\n"), new PromptContext(values), undefined, { escape: value => value });
}
