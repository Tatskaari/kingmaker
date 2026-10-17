import assert from "node:assert/strict";
import { test } from "node:test";
import type { InventedLook } from "../module_bindings/types.ts";
import { baseLook } from "./appearance.ts";
import { inventionVersion, LookCache, lookCache, setLookCache } from "./invent.ts";
import { INVENTED_BY, inventionOf, keepInvented } from "./invented.ts";
import { parseName } from "./names.ts";

/**
 * Invented looks (town-design §3.7, §3.9): a look row's invention goes into the look layer's cache
 * by the key of the thing's name, once, and the look layer draws the thing by it, not by a guess.
 */

const SWAN: InventedLook = { glyph: "v", nerd: undefined, color: "white", motion: "bob", light: false, being: true, group: false, material: undefined };

test("a look row's invention is kept by its name's key, with the AI service's mark, once", () => {
  setLookCache(new LookCache());
  const [key, invention] = inventionOf("a disgruntled swan", SWAN, "creature");
  assert.equal(key, parseName("a disgruntled swan").key);
  assert.deepEqual(invention, { glyph: "v", color: "white", motion: "bob", light: false, being: true, group: false, name: "a disgruntled swan", kind: "creature", model: INVENTED_BY, at: "" });

  const version = inventionVersion();
  assert.equal(keepInvented("a disgruntled swan", SWAN, "creature"), true);
  assert.equal(lookCache().get(key)?.glyph, "v");
  assert.ok(inventionVersion() > version, "the look layer's guesses look again");
  assert.equal(keepInvented("a disgruntled swan", SWAN, "creature"), false, "the same again is kept already");
  assert.equal(keepInvented(undefined, SWAN), false, "no thing to name it by, nothing kept");
  assert.equal(keepInvented("a swan", undefined), false);
});

test("the look layer draws a kept invention, not a guess", () => {
  setLookCache(new LookCache());
  const thing = { id: "thing-1", name: "a sackbut of great age", kind: "object", tags: [], created: 3 };
  const guessed = baseLook(thing);
  keepInvented(thing.name, { ...SWAN, glyph: "♪", color: "brass", being: false, motion: "still" });
  const drawn = baseLook(thing);
  assert.equal(drawn.source, "cache", `drawn by the invention (was ${guessed.source})`);
  assert.equal(drawn.glyph.ascii, "♪");
});
