import { create } from "@bufbuild/protobuf";
import { DocumentSchema, type WorldState } from "../packages/contracts/src/v2.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
export function assignActivity(world: WorldState, id: string, goal: string) {
  const entry = characterEntry(world, id), activity = entry.replace("character.md", "task.md");
  world.docs[activity] = create(DocumentSchema, { frontmatter: { visibility: "private", readers: [`character:${id}`],
    name: goal, status: "Assigned", success_criteria: goal, current_goal: goal } });
  world.simulation!.runtimeCharacters[id]!.activity = activity;
}
import { loadPlayableWorld } from "../scripts/lib/playable-world.js";
import { InventorySchema } from "../packages/contracts/src/index.js";
import { characterDocuments } from "../packages/lore/src/character-id.js";
export { loadPlayableWorld };
export function physicalFixture(source: WorldState = loadPlayableWorld()) {
  return { source, world: source.simulation!.map!, characters: characterDocuments(source).map(({ id, document, character }) => {
    character.inventory ??= create(InventorySchema);
    return { id, name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
      get inventory() { return character.inventory!; }, dnd: character.dnd };
  }) };
}

/** Script a review using the real document/activity tools, then a plain final response. */
export function commitReview(result: { summary: string; newNotes: string[]; activeGoal: string | null },
  request?: import("../packages/providers/src/openrouter.js").ChatCompletionRequest) {
  const { activeGoal, summary, newNotes } = result;
  const messages = request?.messages ?? [];
  const lastConflict = messages.findLastIndex(message => message.role === "system" && message.content?.includes('"document_conflict"'));
  if (messages.slice(lastConflict + 1).some(message => message.role === "tool" && message.tool_call_id === "fixture-intent")) {
    return { role: "assistant" as const, content: summary, tool_calls: [] };
  }
  const snapshots = messages.flatMap(message => {
    try {
      const value = JSON.parse(message.content ?? "");
      return value.document?.path ? [value.document] : value.current?.path ? [value.current] : [];
    } catch { return []; }
  });
  const current = snapshots.filter(snapshot => snapshot.path === snapshots[0]?.path).at(-1);
  const notes = newNotes.filter(note => !current?.document.body.includes(note));
  return { role: "assistant" as const, content: null, tool_calls: [
    ...(notes.length ? [{ id: "review", type: "function" as const, function: { name: "replace_document", arguments: JSON.stringify({
      path: current?.path ?? "fixture.md", expectedSha: current?.sha ?? "fixture", oldText: current?.document.body ?? "Fixture",
      newText: (current?.document.body ?? "Fixture") + "\n" + notes.map(note => `- ${note}`).join("\n"),
    }) } }] : []),
    { id: "fixture-intent", type: "function" as const, function: activeGoal ? { name: "set_activity", arguments: JSON.stringify({
      name: activeGoal, status: "Assigned", success_criteria: activeGoal, current_goal: activeGoal,
    }) } : { name: "clear_activity", arguments: "{}" } },
  ] };
}
