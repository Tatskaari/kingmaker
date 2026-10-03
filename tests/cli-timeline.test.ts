import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CliTimeline } from "../apps/conversation-cli/timeline.js";

test("CLI timeline interleaves repeated dialogue, updated calls and expanded context", () => {
  let now = 100;
  const timeline = new CliTimeline(() => now);
  const system = { role: "system" as const, content: "Prompt" };
  const user = { role: "user" as const, content: "Hello" };
  const reply = { role: "assistant" as const, content: "Hello" };
  timeline.recordMessages([system, user]);
  now = 200;
  timeline.record("jev-1");
  timeline.record("gm-1"); // Same millisecond: preserve event order.
  timeline.recordMessages([system, user, reply]);
  now = 300;
  timeline.recordMessages([system, user, reply, user]);
  timeline.record("jev-2");
  timeline.record("jev-1"); // Completion must not reorder an earlier call.
  const expanded = [system, { role: "system" as const, content: "New lore" }, user, reply, user, reply];
  timeline.recordMessages(expanded);
  const ids = timeline.messageIds(expanded);
  const entries = timeline.sort([
    ...ids.map((timeId, index) => ({ id: `message-${index}`, timeId })),
    { id: "gm-1", timeId: "gm-1" },
    { id: "jev-1", timeId: "jev-1" },
    { id: "opened", timeId: "jev-1" },
    { id: "jev-2", timeId: "jev-2" },
    { id: "pending", timeId: "unobserved" },
  ]);
  assert.deepEqual(entries.map(entry => entry.id), ["message-0", "message-2", "jev-1", "opened", "gm-1",
    "message-3", "message-4", "jev-2", "message-1", "message-5", "pending"]);
});
