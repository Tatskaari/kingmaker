import assert from "node:assert/strict";
import test from "node:test";
import { storyMapView } from "../apps/web/src/story-map.js";

const graph = { id: "cushions", title: "Cushion caper", active: true, currentNode: "asking", history: ["greeted"],
  nodes: [{ id: "hello", title: "Hello", guidance: "Greet them.", completed: false }, { id: "asking", title: "Ask for help", guidance: "Make the dreadful request.", completed: false }],
  edges: [{ id: "greeted", from: "hello", to: "asking", condition: "A greeting happened.", trigger: "GM discretion" }],
  characterId: "aldren", live: { node: "asking", phase: "checking", conditions: [{ id: "greeted", decision: { choice: "hit" } }] } };

test("story map renders live nodes, paths, sprites and nametags", () => {
  const html = storyMapView({ quests: [], conversations: [graph] }, { kind: "conversations" }, [{ id: "aldren", name: "King Aldren", sprite: 84 }]);
  for (const text of ["King Aldren", "data-portrait=\"aldren\"", "GM is here", "Make the dreadful request", "Checking which path", "→ asking", "class=\"hit\""]) assert.match(html, new RegExp(text));
  assert.match(html, /aria-pressed="true">Conversation trees/);
});

test("story map defaults to an active quest and escapes authored copy", () => {
  const { characterId: _characterId, live: _live, ...base } = graph;
  const quest = { ...base, id: "quest", title: "A & B" };
  const html = storyMapView({ quests: [quest], conversations: [] });
  assert.match(html, /A &amp; B/);
  assert.match(html, /aria-pressed="true">Quest trees/);
  assert.doesNotMatch(html, /data-portrait/);
});

test("story map distinguishes repeated cast nametags", () => {
  const guard = { ...graph, id: "guard-one", characterId: "guard-one" };
  const html = storyMapView({ quests: [], conversations: [guard] }, { kind: "conversations" }, [
    { id: "guard-one", name: "Palace Guard", roomId: "west-wing" }, { id: "guard-two", name: "Palace Guard", roomId: "great-hall" },
  ]);
  assert.match(html, /west-wing · asking/);
});
