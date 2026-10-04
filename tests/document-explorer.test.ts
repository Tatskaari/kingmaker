import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Browser renderer is JavaScript.
import { documentExplorer } from "../apps/web/src/document-explorer.js";

const data = { scenario: "Scenes/scene.md", docs: {
  "index.md": { body: "Root" }, "Scenes/scene.md": { body: "# Court\n\n[[index|Home]]", frontmatter: { summary: "Court" } },
}, history: [{ path: "Scenes/scene.md", updatedAt: "2026-10-03T12:00:00Z", toolCallId: "review",
  call: { id: 1, characterId: "rowan", kind: "conversation_review", status: "success", request: { messages: [{ role: "user", content: "Please remember." }] },
    response: { tool_calls: [{ id: "review", function: { name: "set_activity", arguments: '{"summary":"Remember the promise","newNotes":["A promise"],"activeGoal":null}' } }] } } },
  { path: "index.md", call: { response: "UNRELATED" } }],
};

test("explorer shows breadcrumbs, selected directory, rendered document and scoped tool history", () => {
  const html = documentExplorer(data, {}, { rowan: "Lord Rowan" });
  assert.match(html, /aria-label="Document navigation"/);
  assert.match(html, /data-doc-path="Scenes\/"/);
  assert.match(html, /<li aria-current="page"><a[^>]*data-doc-path="Scenes\/scene.md"/);
  assert.match(html, /<h1 id="doc-heading-court">Court/);
  assert.match(html, /popover[^>]*role="dialog" aria-label="Recent document updates"/);
  assert.match(html, /History \(1\)/);
  assert.match(html, /Lord Rowan · conversation review/);
  assert.match(html, /set_activity/);
  assert.match(html, /Please remember/);
  assert.doesNotMatch(html, /Could not read structured review output/);
  assert.doesNotMatch(html, /UNRELATED/);
});

test("folder breadcrumbs navigate directories and missing documents have a recoverable state", () => {
  const folder = documentExplorer(data, { path: "Scenes/" });
  assert.match(folder, /<h2>Scenes<\/h2>/);
  assert.doesNotMatch(folder, /popovertarget=/);
  assert.match(documentExplorer(data, { path: "removed.md" }), /no longer available/);
  assert.match(documentExplorer({ docs: { "empty.md": { body: "Empty" } } }, { path: "empty.md" }), /No recent tool updates/);
});
