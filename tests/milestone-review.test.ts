import assert from "node:assert/strict";
import test from "node:test";
import { loadPlayableWorld } from "./fixtures.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";

test("milestone reviews update live trees, retain failed recipients and resume without rebroadcast", async () => {
  let fail = true, calls = 0;
  const game = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, { services: { ai: {
    decisions: async (_input, questions) => Object.fromEntries(Object.keys(questions).map(name => [name, { choice: "ignore", reason: "test" }])),
    responses: async request => {
      calls++;
      if (fail) throw new Error("review unavailable");
      // Exercise the actual document tools and validation, including a live current node.
      const input = request.messages.find(message => message.content?.includes('"characterId":"aldren"') && message.content.includes('"document":'));
      if (input && !request.messages.some(message => message.role === "tool")) {
        const tree = await game.services.docs.read("Conversations/aldren.md");
        return { role: "assistant", content: null, tool_calls: [{ id: "update-tree", type: "function", function: {
          name: "replace_document", arguments: JSON.stringify({ path: tree.path, expectedSha: tree.sha,
            oldText: tree.document.body, newText: tree.document.body.replace("### Guidance", "### Guidance\nThe entrance is clear; thank the player and await delivery.") }),
        } }] };
      }
      return { role: "assistant", content: "Dialogue reviewed." };
    },
  } } });
  await game.services.hooks.bind()["back-out-cart.ts"]!(new AbortController().signal);
  const memories = Object.keys(game.world().docs).filter(path => path.endsWith("/cart-cleared.md"));
  await assert.rejects(game.reviewPendingMilestones(new AbortController().signal), /review unavailable/);
  assert.equal(game.hasPendingMilestoneReviews(), true);
  game.restore(game.snapshot());
  fail = false;
  await game.reviewPendingMilestones(new AbortController().signal);
  assert.equal(game.hasPendingMilestoneReviews(), false);
  assert.match(game.world().docs["Conversations/aldren.md"]!.body, /entrance is clear/);
  const completedCalls = calls;
  await game.reviewPendingMilestones(new AbortController().signal);
  assert.equal(calls, completedCalls);
  assert.deepEqual(Object.keys(game.world().docs).filter(path => path.endsWith("/cart-cleared.md")), memories);
});
