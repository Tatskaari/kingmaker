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
import { projectWorld } from "./legacy-world-fixture.js";
export { loadPlayableWorld };
export const physicalFixture = () => projectWorld(loadPlayableWorld());

export function commitReview(result: { summary: string; newNotes: string[]; activeGoal: string | null }) {
  const { activeGoal, ...review } = result;
  return { role: "assistant" as const, content: null, tool_calls: [
    { id: "intent", type: "function" as const, function: activeGoal ? { name: "set_activity", arguments: JSON.stringify({
      name: activeGoal, status: "Assigned", success_criteria: activeGoal, current_goal: activeGoal,
    }) } : { name: "clear_activity", arguments: "{}" } },
    { id: "review", type: "function" as const, function: { name: "commit_review", arguments: JSON.stringify(review) } },
  ] };
}
