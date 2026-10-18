import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine, type SoundMessage } from "./engine.ts";
import { MOODS } from "./music.ts";
import { SFX, type Cue } from "./patches.ts";

/**
 * The engine (docs/sound-design.md), played offline: every sound is heard, stays under full scale
 * and is over in a few seconds; a seed makes the same sound; the music plays in each mood and goes
 * when it's changed; a hush stops what's still to come; a bus turned down is quiet.
 */

const RATE = 22050;

/** An engine told `messages`, played for `seconds`: its left channel. `during` is told the engine at each block, and the time (s). */
function played(messages: SoundMessage[], seconds: number, seed = 1, during?: (engine: Engine, t: number) => void): { left: Float32Array; engine: Engine } {
  const engine = new Engine(RATE, seed);
  engine.receive({ type: "volume", volumes: { master: 1, sfx: 1, voice: 1, music: 1 } });
  for (const m of messages) engine.receive(m);
  const n = Math.round(seconds * RATE), block = 128;
  const left = new Float32Array(n), l = new Float32Array(block), r = new Float32Array(block);
  for (let i = 0; i < n; i += block) {
    during?.(engine, i / RATE);
    engine.render(l, r);
    left.set(l.subarray(0, Math.min(block, n - i)), i);
  }
  return { left, engine };
}

const peak = (a: Float32Array, from = 0, to = a.length) => { let p = 0; for (let i = from; i < to; i++) p = Math.max(p, Math.abs(a[i]!)); return p; };
const finite = (a: Float32Array) => a.every(Number.isFinite);

test("every sound effect is heard, stays under full scale, and is over within a few seconds", () => {
  const cues: Cue[] = [
    ...SFX.map(sfx => ({ sfx, ms: 300, size: 20 })),
    ...["fire", "cold", "lightning", "thunder", "acid", "poison", "necrotic", "radiant", "force", "psychic"].flatMap(element =>
      (["spell.cast", "spell.bolt", "spell.hit", "spell.area", "blow.hit"] as const).map(sfx => ({ sfx, element, ms: 300, size: 20, count: 3 }))),
  ];
  for (const cue of cues) {
    const { left, engine } = played([{ type: "sfx", cue }], 5);
    const what = `${cue.sfx}${cue.element ? ` (${cue.element})` : ""}`;
    assert.ok(finite(left), `${what}: every sample a number`);
    assert.ok(peak(left) > 0.001, `${what}: heard (peak ${peak(left)})`);
    assert.ok(peak(left) < 0.98, `${what}: under full scale (peak ${peak(left)})`);
    assert.deepEqual(engine.load, { playing: 0, waiting: 0 }, `${what}: over within five seconds`);
  }
});

test("a seed makes the same sound, and another seed another", () => {
  const roll: SoundMessage[] = [{ type: "sfx", cue: { sfx: "dice.roll" } }];
  const a = played(roll, 1, 5).left, b = played(roll, 1, 5).left, c = played(roll, 1, 6).left;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("the music plays in each mood, and a change of mood (or none) lets the last song go", () => {
  for (const mood of MOODS) {
    const { left, engine } = played([{ type: "music", mood }], 12);
    assert.ok(finite(left), `${mood}: every sample a number`);
    assert.ok(peak(left, RATE * 2) > 0.01, `${mood}: heard`);
    assert.ok(peak(left) < 0.98, `${mood}: under full scale`);
    assert.equal(engine.mood, mood);
  }
  // The title's, then the fight's, then none: four seconds after it's stopped, nothing is left playing.
  const { left, engine } = played([{ type: "music", mood: "title" }], 14, 1, (e, t) => {
    if (Math.abs(t - 4) < 0.003) e.receive({ type: "music", mood: "fight" });
    if (Math.abs(t - 8) < 0.003) e.receive({ type: "music", mood: null });
  });
  assert.equal(engine.mood, undefined);
  assert.ok(peak(left, RATE * 5, RATE * 7) > 0.01, "the fight's music after the title's");
  assert.ok(peak(left, RATE * 13) < 0.001, "quiet once it's stopped (and its room has died away)");
});

test("a hush stops what's still to come of its group, and nothing of the rest", () => {
  const voice = { pitch: 220, wave: "square" as const, range: 4, length: 40, bright: 0.4, gain: 0.08 };
  const talk: SoundMessage[] = Array.from({ length: 20 }, (_, i) => ({ type: "blip", voice, letter: "a", delay: i * 100, group: "talk" }));
  const { left } = played([...talk, { type: "sfx", cue: { sfx: "ui.choose" }, delay: 1500 }], 2.5, 1, (e, t) => {
    if (Math.abs(t - 0.5) < 0.003) e.receive({ type: "hush", group: "talk" });
  });
  assert.ok(peak(left, 0, RATE * 0.45) > 0.01, "the talk before the hush");
  assert.ok(peak(left, RATE * 0.6, RATE * 1.45) < 0.0005, "none after it");
  assert.ok(peak(left, RATE * 1.5, RATE * 2) > 0.01, "another group's sound plays on");
});

test("a bus turned down is quiet", () => {
  const { left } = played([{ type: "volume", volumes: { sfx: 0 } }, { type: "sfx", cue: { sfx: "spell.area", element: "fire" } }], 1);
  assert.ok(peak(left, RATE * 0.1) < 0.0005);
  const music = played([{ type: "volume", volumes: { music: 0 } }, { type: "music", mood: "fight" }], 3).left;
  assert.ok(peak(music, RATE * 0.5) < 0.0005);
});
