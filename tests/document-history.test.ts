import assert from "node:assert/strict";
import test from "node:test";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { commitReview } from "./fixtures.js";

test("document history is bounded, redacted, and retains calls beyond the ordinary transcript window", async () => {
  const traces = new ModelTranscripts("secret-key");
  for (let index = 0; index < 55; index++) {
    const response = commitReview({ summary: `Update ${index}`, newNotes: ["secret-key"], activeGoal: null });
    await traces.record("conversation_review", "rowan", { key: "secret-key" }, async () => response);
    traces.documentUpdated({ path: `${index}.md`, beforeSha: "before", afterSha: "after", response, toolCallId: "review" });
  }
  for (let index = 0; index < 55; index++) await traces.record("dialogue", "rowan", {}, async () => ({}));
  const history = traces.documentWrites();
  assert.equal(history.length, 50);
  assert.equal(history[0]!.path, "54.md");
  assert.equal(history.at(-1)!.path, "5.md");
  assert.equal(history[0]!.call.kind, "conversation_review");
  assert.match(JSON.stringify(history), /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(history), /secret-key/);
  history[0]!.path = "changed";
  assert.equal(traces.documentWrites()[0]!.path, "54.md");
});
