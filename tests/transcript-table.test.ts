import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Browser renderer is JavaScript.
import { transcriptSessions, recentTranscriptsView, conversationTranscriptView } from "../apps/web/src/debug-view.js";

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


test("disclosure lists document paths with threshold decisions and open documents first", () => {
  const entry = { ...calls[0], kind: "prog_disc", request: { disclosure: { threshold: 0.7, candidates: [
    { id: "open_1", path: "Cast/Skipped.md", from: "entry", summary: "At threshold" },
    { id: "open_2", path: "Cast/<Opened>.md", from: "entry", summary: "<Summary>" },
    { id: "open_3", path: "Cast/Unknown.md", from: "entry" },
  ] } }, response: {
    open_1: { choice: "open_1", probabilities: { open_1: 0.7, skip: 0.3 } },
    open_2: { choice: "open_2", probabilities: { open_2: 0.9, skip: 0.1 } },
  } };
  const html = recentTranscriptsView([entry], {}, { characterId: "corvin" });
  const summary = html.split('<div class="transcript-summary">')[1].split("<details>")[0];
  assert.match(summary, /Documents considered \(3\)/);
  assert.match(summary, /1 selected to open/);
  assert.match(summary, /success">Open<\/span>/);
  assert.match(summary, /error">Not opened<\/span>/);
  assert.match(summary, /pending">No decision<\/span>/);
  assert.ok(summary.indexOf("Cast/&lt;Opened&gt;.md") < summary.indexOf("Cast/Skipped.md"));
  assert.match(summary, /&lt;Summary&gt;/);
  assert.doesNotMatch(summary, /open_1|open_2|<Opened>|<Summary>/);
});

test("conversation context shows all exact input messages followed by the response", () => {
  const html = conversationTranscriptView({ characterId: "rowan", contextCall: { id: 1, status: "success", request: { messages: [
    { role: "system", content: "Original instructions" },
    { role: "system", content: "# Disclosed lore\n<private belief>" },
    { role: "user", content: "First line\nSecond line" },
    { role: "assistant", content: "Earlier reply" },
    { role: "system", content: "<binding ruling>" },
  ] }, response: { role: "assistant", content: "A reply" } } }, { rowan: "<Rowan>" });
  const expected = ["Original instructions", "# Disclosed lore\n&lt;private belief&gt;", "First line\nSecond line", "Earlier reply", "&lt;binding ruling&gt;", "A reply"];
  for (const [index, text] of expected.entries()) {
    assert.ok(html.includes(text));
    if (index) assert.ok(html.indexOf(expected[index - 1]) < html.indexOf(text));
  }
  assert.match(html, /5 input messages/);
  assert.match(html, /6 · assistant · Response/);
  assert.match(html, /&lt;Rowan&gt;/);
  assert.match(conversationTranscriptView({ conversation: [{}] }), /Full context is unavailable/);
  assert.match(conversationTranscriptView({ conversation: [] }), /No character request captured/);
});
