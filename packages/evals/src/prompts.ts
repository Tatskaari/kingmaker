import { readPromptCatalog } from "../../prompts/src/catalog.js";
import { renderCatalogPrompt } from "../../prompts/src/index.js";

const catalog = readPromptCatalog(new URL("../../../evals/prompts/", import.meta.url));

export function renderPrompt(id: string, values: Record<string, unknown> = {}): string {
  return renderCatalogPrompt(catalog, id, values);
}
