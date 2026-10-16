import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devFake, fakeOf } from "./stack.ts";

const file = JSON.parse(readFileSync(join(import.meta.dirname, "fake.json"), "utf8"));
const fake = devFake();
const notes = (fake.byName!.notes as { notes: Array<{ on: string; words: string; kind: string; turn: number; lore: string }> }).notes;

test("the dev host's fake is fake.json's options: four replies, the notes' answer, nine lines, the delays", () => {
  const { about, ...options } = file;

  assert.match(about, /^What npm run dev -- --fake plays/);
  assert.deepEqual(fake, options);
  assert.equal(fake.replies!.length, 4);
  assert.match(fake.replies![0]!, /^Behind the King’s Granary/);
  assert.deepEqual(notes.map(n => n.kind), ["know", "why", "why", "you", "why", "know"]);
  assert.deepEqual(String(fake.suggestions).split("\n").map(l => l.split(":")[0]), ["say", "say", "do", "try", "say", "say", "do", "try", "leave"]);
  assert.deepEqual([fake.streamMs, fake.byNameDelayMs, fake.suggestDelayMs], [2000, { notes: 1500 }, 800]);
});

test("each note is on free words of its own reply, so the same answer gives each reply its own notes", () => {
  const inReplies = (words: string) => fake.replies!.flatMap((r, i) => (r.includes(words) ? [i] : []));

  assert.ok(notes.every(n => n.on === ""));
  assert.deepEqual(Object.fromEntries(notes.map(n => [n.words, inReplies(n.words)])), {
    "King’s Granary": [0],
    "I haven’t written that down.": [0, 1],
    "And Cob don’t talk to bluebottles.": [1],
    "Moll’s smirk thins at your question": [2],
    "The rest is not yet stated.": [2],
    "the Royal Purveyor’s office": [3],
  });
  // A know explains from a lore doc by its id in the notes' brief: the granary yard is the scene's
  // first, and the office's is 18th once Kell, Cob and Moll have been named (the third reply's turn).
  assert.deepEqual(notes.filter(n => n.kind === "know").map(n => n.lore), ["D1", "D18"]);
});

test("KM_AI_FAKE is the caller's options, else the user's own, else fake.json's", () => {
  assert.equal(fakeOf({ fake: { streamMs: 3000 } }, { KM_AI_FAKE: "{}" }), '{"streamMs":3000}');
  assert.equal(fakeOf({}, { KM_AI_FAKE: "{}" }), "{}");
  assert.deepEqual(JSON.parse(fakeOf({}, {})), fake);
});
