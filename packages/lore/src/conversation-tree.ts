import { parseMarkdown, type Note } from "./markdown.js";
import { compileAuthoredGraph } from "./authored-graph.js";

/** A GM-owned dialogue graph backed by the existing quest progress service. */
export function parseConversationTree(markdown: string) {
  return compileConversationTree(parseMarkdown(markdown));
}

export function compileConversationTree(note: Note) {
  const graph = compileAuthoredGraph(note);
  const characterId = note.metadata.character;
  if (typeof characterId !== "string" || !characterId.trim()) throw new Error("Conversation tree requires character");
  return { ...graph, characterId };
}
export type ConversationTree = ReturnType<typeof parseConversationTree>;
