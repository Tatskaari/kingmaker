import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceOf, Voices } from "./voices.ts";

/** Voices (voices.ts): a creature sounds like one, what's said of someone leans their register, and a person keeps the voice they were first heard in. */

test("creatures sound like what they are", () => {
  assert.ok(voiceOf({ key: "rex", tags: ["dog"] }).rough, "a dog growls");
  assert.ok(voiceOf({ key: "crow-1", name: "a crow" }).pitch > 1000, "a bird chirps");
});

test("what's said of someone leans their register: a woman's higher, a man's lower, a child's higher still, a big one's lower", () => {
  const keys = Array.from({ length: 40 }, (_, i) => `someone-${i}`);
  const hers = keys.map(key => voiceOf({ key, description: "she watches people's hands" }).pitch);
  const his = keys.map(key => voiceOf({ key, description: "he fills the doorway" }).pitch);
  assert.ok(Math.min(...hers) > 180 && Math.max(...his) < 245, `hers from ${Math.min(...hers)}, his to ${Math.max(...his)}`);
  assert.ok(voiceOf({ key: "cob", called: "the boy in the too-big boots" }).pitch > voiceOf({ key: "cob", description: "he fills the doorway" }).pitch, "a boy's above a man's of the same key");
  assert.ok(voiceOf({ key: "hobb", size: "large" }).pitch < voiceOf({ key: "hobb" }).pitch, "a large one's lower");
});

test("a person keeps the voice they were first heard in, whatever's known of them later; another game's people are heard afresh", () => {
  const voices = new Voices();
  const first = voices.of({ key: "kell", description: "she watches people's hands" });
  assert.equal(voices.of({ key: "kell" }), first);
  voices.forget();
  assert.notEqual(voices.of({ key: "kell" }), first);
});
