import assert from "node:assert/strict";
import test from "node:test";
import { questFeedItems, questLogContent } from "../apps/web/src/quest-log.js";

test("active quest feed shows title launchers without stage details", () => {
  const html = questFeedItems([{ id: "delivery", title: "Pillow <delivery>" }]);
  assert.match(html, /data-quest-id="delivery"/);
  assert.match(html, /Pillow &lt;delivery&gt;/);
  assert.doesNotMatch(html, /Current|Completed|description/);
});

test("quest log expands the active stage and collapses completed stages", () => {
  const html = questLogContent({ title: "Delivery", stages: [
    { title: "Find the pillows", description: "Ask Holt.", status: "completed" },
    { title: "Clear the cart", description: "Help Rowan.", status: "active" },
  ] });
  assert.match(html, /<details ><summary><span class="quest-stage-status">Completed/);
  assert.match(html, /<details open><summary><span class="quest-stage-status">Current/);
  assert.ok(html.indexOf("Find the pillows") < html.indexOf("Clear the cart"));
});
