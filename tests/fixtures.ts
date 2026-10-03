import { loadPlayableWorld } from "../scripts/lib/playable-world.js";
import { projectWorld } from "../apps/web/src/world-projection.js";
export { loadPlayableWorld };
export const physicalFixture = () => projectWorld(loadPlayableWorld());

export function commitReview(result: { summary: string; newNotes: string[]; activeGoal: string | null }) {
  return { role: "assistant" as const, content: null, tool_calls: [{ id: "review", type: "function" as const,
    function: { name: "commit_review", arguments: JSON.stringify(result) } }] };
}
