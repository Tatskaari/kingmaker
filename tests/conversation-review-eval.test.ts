import assert from "node:assert/strict";
import test from "node:test";
import { runConversationReviewEval } from "../packages/evals/src/conversation-review-eval.js";
import { commitReview, loadPlayableWorld } from "./fixtures.js";

for (const mode of ["travel", "wait", "unrelated", "error"] as const) {
  test(`conversation review eval scores ${mode} from committed runtime state`, async () => {
    let calls = 0;
    const result = await runConversationReviewEval(loadPlayableWorld(), "", { services: {
      disclosure: { disclose: async () => [] }, ai: {
        responses: async request => {
          calls++;
          assert.match(request.messages[0]!.content!, /^You are a game master/);
          assert.match(JSON.stringify(request), /physicalState.*great_hall/);
          assert.match(JSON.stringify(request), /I hurry off/);
          if (mode === "error") throw new Error("Provider unavailable");
          if (mode === "wait" && calls === 1) return { role: "assistant", content: null, tool_calls: [
            { id: "wait", type: "function", function: { name: "set_wait", arguments: JSON.stringify({
              name: "Wait in the parlour", instructions: "Wait for the player to arrive.", activities: [],
            }) } },
          ] };
          const reply = commitReview({ summary: "Reviewed", newNotes: [], activeGoal: "Go to the parlour and wait for the player." });
          if (mode === "wait") {
            assert.equal(request.messages.at(-1)?.role, "tool");
            reply.tool_calls.shift();
          }
          return reply;
        },
        decisions: async (_state, questions) => {
          const choice = mode === "unrelated" ? "wait" : "open_guest_door_1";
          assert.ok(questions.next!.criteria[choice]);
          return { next: { choice, probabilities: {} } };
        },
      },
    } });
    assert.equal(result.success, mode === "travel", result.error ?? JSON.stringify(result.milestones));
    if (mode === "wait") {
      assert.equal(calls, 2);
      assert.equal(result.milestones.reviewCommitted, true);
      assert.equal(result.milestones.noPrematureWait, false);
      assert.equal(result.milestones.activityAssigned, false);
    }
    if (mode === "error") assert.match(result.error!, /Provider unavailable/);
    else assert.equal(result.milestones.mapUnchanged, true);
  });
}
