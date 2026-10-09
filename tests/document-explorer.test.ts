import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Browser renderer is JavaScript.
import { documentExplorer } from "../apps/web/src/document-explorer.js";

const data = { scenario: "Scenes/scene.md", docs: {
  "index.md": { body: "Root" }, "Scenes/scene.md": { body: "# Court\n\n[[index|Home]]", frontmatter: { summary: "Court" } },
}, history: [{ path: "Scenes/scene.md", updatedAt: "2026-10-03T12:00:00Z", toolCallId: "review", beforeText: "Old memory", afterText: "New memory",
  call: { id: 1, conversationId: "conversation-1", turnId: "turn-1", spanId: "span-1", participantIds: ["rowan", "player"], characterId: "rowan", kind: "conversation_review", status: "success", request: { messages: [{ role: "user", content: "Please remember." }] },
    response: { tool_calls: [{ id: "review", function: { name: "set_activity", arguments: '{"summary":"Remember the promise","newNotes":["A promise"],"activeGoal":null}' } }] } } },
],
};

test("explorer shows breadcrumbs, selected directory, rendered document and general tool history", () => {
  const html = documentExplorer(data, {}, { rowan: "Lord Rowan" });
  assert.match(html, /aria-label="Document navigation"/);
  assert.match(html, /data-doc-path="Scenes\/"/);
  assert.match(html, /<li aria-current="page"><a[^>]*data-doc-path="Scenes\/scene.md"/);
  assert.match(html, /<h1 id="doc-heading-court">Court/);
  assert.match(html, /popover[^>]*role="dialog" aria-label="Recent edits"/);
  assert.match(html, /Recent edits/);
  assert.match(html, /Conversation between Lord Rowan and player/);
  assert.match(html, /set_activity/);
  assert.match(html, /Please remember/);
  assert.doesNotMatch(html, /Could not read structured review output/);
  assert.doesNotMatch(html, /UNRELATED/);
});

test("folder breadcrumbs navigate directories and missing documents have a recoverable state", () => {
  const folder = documentExplorer(data, { path: "Scenes/" });
  assert.match(folder, /<h2>Scenes<\/h2>/);
  assert.match(folder, /popovertarget="document-history"/);
  assert.match(documentExplorer(data, { path: "removed.md" }), /no longer available/);
  assert.match(documentExplorer({ docs: { "empty.md": { body: "Empty" } } }, { path: "empty.md" }), /No recent edits/);
});


test("history groups multiple calls and documents by turn, escapes diffs and counts tool operations", () => {
  const base = data.history[0]!;
  const write = (path: string, tool: string, turnId: string, id: string) => ({ ...base, path,
    beforeText: "Same\n<script>old</script>\n", afterText: "Same\nNew\n",
    call: { ...base.call, turnId, spanId: id, response: { tool_calls: [{ id: "review", function: { name: tool, arguments: "{}" } }] } },
  });
  const html = documentExplorer({ ...data, history: [
    write("index.md", "replace_document", "turn-2", "a"),
    write("Scenes/scene.md", "insert_document", "turn-2", "b"),
    write("gone.md", "delete_document", "turn-1", "c"),
  ] });
  assert.equal((html.match(/class="doc-edit-group"/g) || []).length, 2);
  assert.match(html, /1 replaces, 1 adds, 0 removals/);
  assert.match(html, /0 replaces, 0 adds, 1 removals/);
  assert.match(html, /doc-diff-add/);
  assert.match(html, /doc-diff-remove/);
  assert.match(html, /&lt;script&gt;old/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /gone.md/);
  assert.match(html, /View transcript/);
});
