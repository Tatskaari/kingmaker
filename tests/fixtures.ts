import { create } from "@bufbuild/protobuf";
import { DocumentSchema, type WorldState } from "../packages/contracts/src/v2.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
export function assignActivity(world: WorldState, id: string, goal: string) {
  const entry = characterEntry(world, id), activity = entry.replace("character.md", "task.md");
  world.docs[activity] = create(DocumentSchema, { frontmatter: { visibility: "private", readers: [`character:${id}`],
    name: goal, status: "Assigned", success_criteria: goal, current_goal: goal } });
  world.runtimeCharacters[id]!.activity = activity;
}
import { loadPlayableWorld } from "../scripts/lib/playable-world.js";
import { InventorySchema } from "../packages/contracts/src/index.js";
import { CharacterPropertiesSchema } from "../packages/contracts/src/v2.js";
import { characterDocuments } from "../packages/lore/src/character-id.js";
export { loadPlayableWorld };
export function physicalFixture(source: WorldState = loadPlayableWorld()) {
  return { source, world: source.map!, characters: characterDocuments(source).map(({ id, document }) => {
    const properties = document.characterProperties ??= create(CharacterPropertiesSchema);
    return { id, name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
      inventory: properties.inventory ??= create(InventorySchema), dnd: properties.dnd };
  }) };
}

export function commitReview(result: { summary: string; newNotes: string[]; activeGoal: string | null }) {
  const { activeGoal, ...review } = result;
  return { role: "assistant" as const, content: null, tool_calls: [
    { id: "intent", type: "function" as const, function: activeGoal ? { name: "set_activity", arguments: JSON.stringify({
      name: activeGoal, status: "Assigned", success_criteria: activeGoal, current_goal: activeGoal,
    }) } : { name: "clear_activity", arguments: "{}" } },
    { id: "review", type: "function" as const, function: { name: "commit_review", arguments: JSON.stringify(review) } },
  ] };
}
