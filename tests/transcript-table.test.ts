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
