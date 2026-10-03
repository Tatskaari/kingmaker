import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Browser renderer is JavaScript.
import { transcriptSessions, recentTranscriptsView } from "../apps/web/src/debug-view.js";

const calls = [1, 2].map(id => ({ id, kind: "jev", characterId: "corvin", status: "success",
  startedAt: "2026-10-01T10:00:00Z", request: { state: "Find the key" }, response: { choice: "walk" } }));
const runs = { goal: { kind: "npc_goal", characterId: "corvin", status: "pending",
  startedAt: "2026-10-01T10:00:00Z", context: { goal: "Find the key" }, calls } };

test("session index deduplicates grouped calls and shows meaningful table data", () => {
  const sessions = transcriptSessions(calls, runs);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].calls.length, 2);
  const html = recentTranscriptsView(calls, runs, { names: { corvin: "Magister Corvin" } });
  assert.match(html, /<table/);
  assert.match(html, /Magister Corvin/);
  assert.match(html, /Find the key/);
  assert.match(html, /<td>2<\/td>/);
  assert.match(html, /Active/);
  assert.doesNotMatch(html, /Full request and response/);
  assert.equal(transcriptSessions([{ ...calls[0], id: 3 }], runs).length, 2);
});

test("session and call routes progressively reveal details and handle expired history", () => {
  const session = recentTranscriptsView(calls, runs, { session: "run:goal" });
  assert.match(session, /data-transcript-call="1"/);
  assert.match(session, /data-transcript-call="2"/);
  assert.doesNotMatch(session, /Full request and response/);
  const call = recentTranscriptsView(calls, runs, { session: "run:goal", call: "2" });
  assert.match(call, /Full request and response/);
  assert.match(call, /Find the key/);
  assert.match(call, /data-transcript-session="run:goal"/);
  assert.match(recentTranscriptsView([], {}, { session: "gone" }), /no longer in the retained history/);
  for (const [status, label] of [["success", "Completed"], ["stopped", "Stopped"], ["error", "Failed"]] as const) {
    assert.match(recentTranscriptsView([], { goal: { ...runs.goal, status } }), new RegExp(label));
  }
});

test("character browser includes shared exchanges and reviews but excludes unrelated nested calls", () => {
  const shared = { ...calls[0], id: 3, kind: "npc_resolution", characterId: "rowan", participantIds: ["rowan", "corvin"],
    conversationId: "exchange", turnId: "review", spanId: "span-review", response: { content: JSON.stringify({ summary: "A shared promise", newNotes: [], activeGoal: null }) } };
  const unrelated = { ...calls[0], id: 4, characterId: "holt", response: { content: "UNRELATED_SECRET" } };
  const archive = { goal: { ...runs.goal, calls: [...calls, unrelated] },
    exchange: { ...runs.goal, characterId: "rowan", participantIds: ["rowan", "corvin"], calls: [shared] },
    unrelated: { ...runs.goal, characterId: "holt", calls: [unrelated] } };
  const html = recentTranscriptsView([shared, unrelated], archive, { characterId: "corvin", names: { corvin: "Corvin" } });
  assert.match(html, /aria-label="Character AI requests"/);
  assert.match(html, /A shared promise/);
  assert.match(html, /Span ID/);
  assert.match(html, /span-review/);
  assert.match(html, /data-transcript-call="1"/);
  assert.match(html, /data-transcript-call="3"/);
  assert.doesNotMatch(html, /UNRELATED_SECRET|data-transcript-call="4"/);
  const stale = recentTranscriptsView([unrelated], archive, { characterId: "corvin", call: "4" });
  assert.match(stale, /no longer available for this character/);
  assert.doesNotMatch(stale, /UNRELATED_SECRET/);
  assert.equal(archive.goal.calls.length, 3, "filtering does not mutate the global archive");
});

test("selected calls remain stable as newer calls arrive and messages are escaped", () => {
  const first = { ...calls[0], request: { messages: [{ role: "user", content: "<script>bad</script>" }] }, response: { content: "First response" } };
  const second = { ...calls[1], response: { content: "Second response" } };
  const html = recentTranscriptsView([second, first], {}, { characterId: "corvin", call: "1" });
  assert.match(html, /First response/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /Second response|<script>/);
  assert.match(recentTranscriptsView([], {}, { characterId: "corvin" }), /No AI requests recorded for this character/);
});
