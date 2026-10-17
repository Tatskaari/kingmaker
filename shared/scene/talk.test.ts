import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene, type SceneDocument } from "./document.ts";
import { sceneOf } from "./load.ts";
import { CONFIDED, FAREWELL, talkOf, talkSceneDocument, talkSceneId, TOLD } from "./talk.ts";

/** A talk's id and its scene from the campaign's template (docs/town-design.md §3.6): the template's own shape is the campaign's (scenes/talk.kmscene). */

const TEMPLATE: SceneDocument = {
  format: "kingmaker", version: 2, kind: "scene", id: "talk", title: "A word with {name}", description: "A word with {name} between scenes.", lore: [],
  hook: "A word with {name}.", setting: "Out in the town.", premise: "A word with {name}.", truth: "Nothing hidden but what {name} keeps back.",
  cast: [{ id: "{companion}", name: "{name}", look: "As their lore describes them.", voice: "Theirs.", wants: "Their own business.", whyHere: "Walking with the player.", knows: [], attitude: "As things stand." }],
  facts: {}, companion: "{companion}",
  nodes: [
    { id: "talk", type: "story", position: { x: 0, y: 0 }, data: { kind: "start", title: "A word between scenes", description: "Play {name}.", lore: [] } },
    { id: "told", type: "story", position: { x: 400, y: 0 }, data: { kind: "beat", title: "Told", description: "{name} has told it.", lore: [] } },
    { id: "goodbye", type: "story", position: { x: 800, y: 0 }, data: { kind: "exit", title: "Goodbye for now", description: "The talk is over.", closing: "Their last word.", result: "good", exitKind: "leave", effects: [], lore: [] } },
  ],
  edges: [
    { id: "goodbye", source: "talk", target: "goodbye", type: "smoothstep", label: "Goodbye", data: { condition: "The player says goodbye or ends the talk (\"{farewell}\"), or walks on.", phase: "outcome", skill: "", dc: 12 } },
    { id: CONFIDED, source: "talk", target: "told", type: "smoothstep", label: "Told", data: { condition: "{name} has told the one thing they were keeping back.", phase: "outcome", skill: "", dc: 12 } },
  ],
};

test("a talk's id says who and which talk it is, both ways", () => {
  assert.equal(talkSceneId("kell", 2), "talk-kell-2");
  assert.deepEqual(talkOf("talk-kell-2"), { companion: "kell", n: 2 });
  assert.deepEqual(talkOf("talk-old-tom-11"), { companion: "old-tom", n: 11 });
  assert.equal(talkOf("hanged-clerk"), undefined);
});

test("the template filled for a companion: its id and companion, their name and id wherever it says so, their card's stats", () => {
  const doc = talkSceneDocument(TEMPLATE, { id: "kell", name: "Sergeant Agnes Kell", statblock: "guard", weapon: "club" }, 1);

  assert.deepEqual([doc.id, doc.kind, doc.companion, doc.title], ["talk-kell-1", "scene", "kell", "A word with Sergeant Agnes Kell"]);
  assert.deepEqual([doc.cast[0]!.id, doc.cast[0]!.name, doc.cast[0]!.statblock, doc.cast[0]!.weapon], ["kell", "Sergeant Agnes Kell", "guard", "club"]);
  assert.equal(doc.edges[0]!.data.condition, `The player says goodbye or ends the talk ("${FAREWELL}"), or walks on.`);
  assert.equal(TEMPLATE.title, "A word with {name}", "the template itself is left as it was");
});

test("as a Scene, a talk is what the template was: its beats talk and told with no transitions, its goodbye an anytime attempt, its way into told the talk's own", () => {
  const scene = sceneOf(talkSceneDocument(TEMPLATE, { id: "kell", name: "Sergeant Agnes Kell" }, 2));

  assert.deepEqual([scene.id, scene.companion, scene.start, scene.beats.map(b => [b.id, b.transitions.length])], ["talk-kell-2", "kell", "talk", [["talk", 0], [TOLD, 0]]]);
  assert.deepEqual(scene.anytime, [{ id: "goodbye", when: `The player says goodbye or ends the talk ("${FAREWELL}"), or walks on.`, on: "attempt", to: "goodbye" }]);
  assert.deepEqual(scene.exits.map(e => [e.id, e.kind]), [["goodbye", "leave"]]);
});

test("the campaign's own template is a talk's: its first cast entry the companion's, its beat told, its one ending goodbye", () => {
  const text = readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", "talk.kmscene"), "utf8");
  const scene = sceneOf(talkSceneDocument(parseScene(text, "talk.kmscene"), { id: "kell", name: "Sergeant Agnes Kell" }, 1));

  assert.deepEqual([scene.cast[0]!.id, scene.cast[0]!.name, scene.beats.map(b => b.id), scene.exits.map(e => e.id)], ["kell", "Sergeant Agnes Kell", ["talk", TOLD], ["goodbye"]]);
  assert.deepEqual(scene.anytime?.map(t => [t.id, t.on]), [["goodbye", "attempt"]]);
  assert.ok(scene.beats.every(b => !b.transitions.length));
  assert.match(scene.opening, /As the talk opens: the player has come over for a word with Sergeant Agnes Kell/);
});
