import assert from "node:assert/strict";
import { test } from "node:test";
import type { Voice } from "./patches.ts";
import { Talker } from "./talker.ts";

/**
 * Talk as it's heard (talker.ts): a blip on each word's first letter and every other letter after it
 * (the narrator's every third), a breath at a comma and a pause at a sentence's end; never more than
 * a moment behind the words: what comes at once is begun, and what streams in while the last words
 * are still being said is said from its newest.
 */

const KELL: Voice = { pitch: 233, wave: "square", range: 5, length: 38, bright: 0.4, gain: 0.065 };
const NARRATOR: Voice = { ...KELL, pitch: 330, every: 3 };

/** A talker on a clock that stands still unless moved on, and the blips it said: the letter, and when (ms from the clock's now). */
function talker() {
  let now = 1000;
  const said: Array<{ letter: string; delay: number; voice: Voice }> = [];
  const t = new Talker("talk", () => now, (voice, letter, delay) => said.push({ letter, delay, voice }));
  return { t, said, wait: (ms: number) => { now += ms; } };
}

test("a blip on each word's first letter and every other after it; a breath at a comma, longer than a word's gap", () => {
  const { t, said } = talker();
  t.speak("Hello there, investigator.", () => KELL);
  assert.equal(said.map(s => s.letter).join(""), "Hloteeivsiao");
  assert.equal(said[0]!.delay, 0, "the first letter at once");
  const word = said[3]!.delay - said[2]!.delay, comma = said[6]!.delay - said[5]!.delay;
  assert.ok(comma > word + 80, `a comma's breath (${comma} ms) beside a word's gap (${word} ms)`);
});

test("a pause at a sentence's end, longer than a comma's breath", () => {
  const { t, said } = talker();
  t.speak("Yes, no. Maybe.", () => KELL);
  const [y, s, n, m] = said.map(b => b.delay);
  assert.ok(m! - n! > n! - s! && n! - s! > s! - y!);
});

test("the narrator says every third letter, and a voice none says nothing", () => {
  const { t, said } = talker();
  t.speak("The yard smells of wet grain.", i => (i < 9 ? NARRATOR : undefined));
  assert.equal(said.map(s => s.letter).join(""), "Tyd");
});

test("a long speech come all at once is begun, as much as a moment allows", () => {
  const { t, said } = talker();
  t.speak("The porters found him at first light, his satchel empty and his spectacles gone, and the Captain called it suicide before breakfast.", () => KELL);
  assert.equal(said[0]!.letter, "T");
  assert.ok(said.every(s => s.delay <= 900), "none more than a moment behind");
  assert.ok(!said.some(s => s.letter === "k"), "not said through to breakfast");
});

test("words streaming in while the last are still being said: after them, from the newest", () => {
  const { t, said, wait } = talker();
  t.speak("Noted.", () => KELL);
  const last = said.at(-1)!.delay;
  t.speak(" Anything else?", () => KELL);
  assert.equal(said.slice(3).map(s => s.letter).join(""), "es", "the newest word, after what was being said");
  assert.ok(said[3]!.delay > last);
  wait(5000);
  t.speak(" Good.", () => KELL);
  assert.ok(said.at(-2)!.delay < 40, "once it's all been said, the next begins at once (after its space)");
});
