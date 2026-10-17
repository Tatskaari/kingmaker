import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFix, locate, MOST_WORDS, tooLong, wordCount } from "./story.ts";

/**
 * A backstory's text (story.ts): where a quote is in it, a fix fitted to where it goes, and how long
 * it may be. Moved with the code from ai/docs/backstory.test.ts, whose lore check tests still
 * apply a fix the check found.
 */

test("finding a quote: exactly, or with case, spacing and quote marks aside", () => {
  const text = "I'm the King's nephew,\n  though nobody says so.";
  assert.deepEqual(locate(text, "the King's nephew"), { start: 4, end: 21 });
  assert.deepEqual(locate(text, "“I’M THE KING’S NEPHEW.”"), { start: 0, end: 21 });
  assert.deepEqual(locate(text, "nephew, though nobody"), { start: 15, end: 38 }, "across the line break, to the end of nobody");
  assert.equal(locate(text, "the Queen's niece"), undefined);
  assert.equal(locate(text, ""), undefined);
});

test("a fix is applied only where its words are, fitted to where it goes", () => {
  const story = "I'm the King's nephew, though nobody at court will say so.\nI came to Caerwyn in the spring, owing Fat Jory three crowns.";
  assert.equal(applyFix(story, { quote: "I'm the King's nephew", problem: "", fix: "I'm a cousin of a minor courtier, twice removed" }), "I'm a cousin of a minor courtier, twice removed, though nobody at court will say so.\nI came to Caerwyn in the spring, owing Fat Jory three crowns.");
  assert.equal(applyFix(story, { quote: "words that aren't there", problem: "", fix: "Something better." }), undefined, "nothing changed where the words aren't");
  assert.equal(applyFix(story, { problem: "", fix: "Something better." }), undefined, "nor where there's no quote");
  // A fix fitted to where it goes: no capital mid-sentence (a name keeps its own), one where a sentence starts, the full stop kept and not doubled.
  const lucan = "I'm the King's nephew, and Sergeant Kell is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.";
  const fix = (quote: string, with_: string, text = lucan) => applyFix(text, { quote, problem: "", fix: with_ });
  assert.equal(fix("Sergeant Kell is my aunt: she taught me to fence.", "A retired watchman taught me to fence near the watch house"),
    "I'm the King's nephew, and a retired watchman taught me to fence near the watch house. I owe Master Fenwick forty crowns.");
  assert.equal(fix("Sergeant Kell is my aunt", "Master Fenwick's cousin is my aunt"), "I'm the King's nephew, and Master Fenwick's cousin is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.");
  assert.equal(fix("I owe Master Fenwick forty crowns.", "my tailor is owed forty crowns."), "I'm the King's nephew, and Sergeant Kell is my aunt: she taught me to fence. My tailor is owed forty crowns.");
  assert.equal(fix("I'm the King's nephew", "I hoped the King would notice me."), "I hoped the King would notice me, and Sergeant Kell is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.");
  // A fix that runs on past its quote, or back before it, doesn't say those words twice.
  const duel = "I left the palace after a duel over a card game and have lived on credit and charm since. I owe my tailor forty crowns.";
  assert.equal(fix("I left the palace after a duel over a card game", "I left a grand house after a duel over a card game, and have lived on credit and charm since.", duel),
    "I left a grand house after a duel over a card game and have lived on credit and charm since. I owe my tailor forty crowns.");
  assert.equal(fix("Sergeant Kell is my aunt", "and a retired watchman is my aunt"), "I'm the King's nephew, and a retired watchman is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.");
  assert.equal(fix("Master Fenwick forty crowns.", "Master Fenwick, my tailor, forty crowns."), "I'm the King's nephew, and Sergeant Kell is my aunt: she taught me to fence. I owe Master Fenwick, my tailor, forty crowns.", "words of its own that happen to match aren't cut");
  // A fix that runs on into the next sentence: no stop of its own, and that sentence goes on from it (a name keeps its capital).
  const clerked = "I clerked under Master Sallow at the Royal Purveyor's office. He's a fussy man. Kell knows it.";
  assert.equal(fix("I clerked under Master Sallow at the Royal Purveyor's office.", "I audited the Royal Purveyor's accounts from the outside, and", clerked), "I audited the Royal Purveyor's accounts from the outside, and he's a fussy man. Kell knows it.");
  assert.equal(fix("He's a fussy man.", "I never met him, but", clerked), "I clerked under Master Sallow at the Royal Purveyor's office. I never met him, but Kell knows it.");
  // A fix with a stop of its own where the quote stopped short of the sentence's: one stop.
  const vouch = "I clerked under Master Sallow. He'd vouch for me to anyone. I left when my mother fell ill.";
  assert.equal(fix("He'd vouch for me to anyone", "I'd vouch for myself to anyone.", vouch), "I clerked under Master Sallow. I'd vouch for myself to anyone. I left when my mother fell ill.");
});

test("a backstory longer than the GM can be given every turn says so (the box keeps it), with its length", () => {
  assert.equal(wordCount("  I owe Fat Jory\nthree crowns. "), 6);
  assert.equal(tooLong("word ".repeat(MOST_WORDS)), undefined);
  assert.match(tooLong("word ".repeat(MOST_WORDS + 345)) ?? "", /^It's 2,345 words, and the GM reads all of it every turn: cut it to 2,000 or fewer\.$/);
});
