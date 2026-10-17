import { test } from "node:test";
import assert from "node:assert/strict";
import type { SceneFile } from "./files.ts";
import { FAREWELL, talkOf, talkSceneFile, talkSceneId } from "./talk.ts";

/** A talk's id and its scene from the campaign's template (docs/town-design.md §3.6): the template's own shape is the campaign's (package A's). */

const TEMPLATE: SceneFile = {
  id: "talk", title: "A word with {name}", summary: "A word with {name} between scenes.", kind: "talk", start: "talk",
  cast: [{ id: "{companion}", name: "{name}", card: "cast/companion.md" }],
  facts: {},
  beats: { talk: { title: "A word between scenes", text: "beats/talk.md", routes: [] }, told: { title: "Told", text: "beats/told.md", routes: [] } },
  anytime: [{ id: "goodbye", on: "attempt", when: "The player says goodbye or ends the talk (\"{farewell}\"), or walks on.", to: "goodbye" }],
  exits: { goodbye: { kind: "leave", title: "Goodbye for now", text: "exits/goodbye.md", effects: [] } },
  essentials: {}, afterwards: [], lore: [],
};

test("a talk's id says who and which talk it is, both ways", () => {
  assert.equal(talkSceneId("kell", 2), "talk-kell-2");
  assert.deepEqual(talkOf("talk-kell-2"), { companion: "kell", n: 2 });
  assert.deepEqual(talkOf("talk-old-tom-11"), { companion: "old-tom", n: 11 });
  assert.equal(talkOf("hanged-clerk"), undefined);
});

test("the template filled for a companion: its id, kind and companion, their name and id wherever it says so, their card's stats", () => {
  const scene = talkSceneFile(TEMPLATE, { id: "kell", name: "Sergeant Agnes Kell", statblock: "guard", weapon: "club" }, 1);

  assert.deepEqual([scene.id, scene.kind, scene.companion, scene.title], ["talk-kell-1", "talk", "kell", "A word with Sergeant Agnes Kell"]);
  assert.deepEqual(scene.cast, [{ id: "kell", name: "Sergeant Agnes Kell", card: "cast/companion.md", statblock: "guard", weapon: "club" }]);
  assert.equal(scene.anytime[0]!.when, `The player says goodbye or ends the talk ("${FAREWELL}"), or walks on.`);
  assert.deepEqual(Object.keys(scene.beats), ["talk", "told"]);
  assert.equal(TEMPLATE.title, "A word with {name}", "the template itself is left as it was");
});
