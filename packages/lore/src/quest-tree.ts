import { compileAuthoredGraph } from "./authored-graph.js";
import { parseMarkdown, type Note } from "./markdown.js";

/** Quest guidance stays GM-owned; triggers are explicit, never inferred from prose. */
export function compileQuestTree(note: Note) {
  const graph = compileAuthoredGraph(note, "quest");
  const active = note.metadata.active;
  if (active !== undefined && typeof active !== "boolean") throw new Error("Quest active must be a boolean");
  return { ...graph, active: active === true };
}

export function parseQuestTree(markdown: string) {
  return compileQuestTree(parseMarkdown(markdown));
}
