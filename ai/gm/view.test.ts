import { test } from "node:test";
import assert from "node:assert/strict";
import type { Markup } from "../../shared/markup.ts";
import { keysFor } from "../../shared/world/rows.ts";
import { hangedClerk, viewAt } from "./fixtures.ts";
import { gameMarkup, localMarkup } from "./view.ts";

/**
 * A view names people by the world's ids, as the copied code does; a request and an answer by the
 * game's keys (v5-design §3.7): the cast by their ids either way, the place's other people under
 * the place, the player's own words "you".
 */

const keys = keysFor("granary-yard", "hanged-clerk", "pc:1");

test("a request's markup by game key is the world's in a view, and an answer's goes back: the cast as they are, the place's own under it, you as you", () => {
  const scene = hangedClerk();
  const world = viewAt(scene).world!;
  world.entities.porter = { id: "porter", name: "the porter", kind: "person", parent: "lane", tags: [], states: [], notes: [] };
  const game: Markup = {
    speech: [{ start: 0, end: 5, speaker: "granary-yard/porter", tag: "the porter" }, { start: 6, end: 9, speaker: "kell" }, { start: 10, end: 12, speaker: "you" }, { start: 13, end: 15 }],
  };
  const local = localMarkup(game, keys);

  assert.deepEqual(local.speech.map(s => s.speaker), ["porter", "kell", "you", undefined]);
  assert.deepEqual(gameMarkup(local, scene, world, keys), game);
});

test("someone the world hasn't got keeps their id: one of the cast away, a name the GM made up", () => {
  const scene = hangedClerk();
  const world = viewAt(scene).world!;
  const markup: Markup = { speech: [{ start: 0, end: 3, speaker: "tull" }, { start: 4, end: 6, speaker: "nobody-here" }] };
  assert.deepEqual(gameMarkup(markup, scene, world, keys).speech.map(s => s.speaker), ["tull", "nobody-here"]);
});
