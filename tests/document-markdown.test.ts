import assert from "node:assert/strict";
import test from "node:test";
import { documentMarkdown } from "../apps/web/src/document-markdown.js";

const path = "Scenarios/Test/character.md";
const paths = [path, "index.md", "Cast/Rowan/private.md", "Scenarios/Test/other.md", "Scenarios/Test/With spaces.md"];

test("document Markdown renders prose, relative links, wiki aliases and reference links", () => {
  const html = documentMarkdown(`# Briefing\n\n**Bold** and *emphasis*.\n\n- [Root](../../index.md)\n- [[Cast/Rowan/private|Rowan]]\n- [Other][note]\n- [Spaces](With%20spaces.md#First%20meeting)\n\n[note]: other.md\n`, path, paths);
  assert.match(html, /<h1 id="doc-heading-briefing">Briefing<\/h1>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  for (const target of ["index.md", "Cast/Rowan/private.md", "Scenarios/Test/other.md", "Scenarios/Test/With spaces.md"]) {
    assert.ok(html.includes(`data-doc-path="${target}"`));
  }
  assert.match(html, /data-doc-anchor="First meeting"/);
  assert.match(html, />Rowan<\/a>/);
});

test("document Markdown keeps anchors and external links usable without executing document HTML", () => {
  const html = documentMarkdown('## Notes\n## Notes\n[Here](#Notes) [Site](https://example.com)\n\n<script>alert(1)</script>\n\n[Bad](javascript:alert%281%29)\n\n`[[other]]`\n\n```md\n[[other]]\n```', path, paths);
  assert.match(html, /id="doc-heading-notes-1"/);
  assert.match(html, /data-doc-anchor="Notes"/);
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>\[\[other\]\]<\/code>/);
  assert.equal((html.match(/data-doc-path=/g) || []).length, 1);
});

test("missing, malformed and ambiguous links never pick the wrong document", () => {
  const html = documentMarkdown('[[private]] [Missing](missing.md) [Bad](bad%ZZ.md)', path,
    [...paths, "Cast/Aldren/private.md"]);
  assert.equal((html.match(/doc-unresolved/g) || []).length, 3);
  assert.doesNotMatch(html, /data-doc-path/);
});
