import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readTuneLibrary } from './tunes.ts';
import { Engine } from '../../client/sound/engine.ts';
import type { SoundLibrary } from '../../client/sound/library.ts';
import type { PartSpec } from '../../client/sound/parts.ts';
import { hz } from '../../client/sound/dsp.ts';
import type { Tune } from '../../client/sound/tune.ts';
import { SFX, type Cue } from '../../client/sound/patches.ts';

const library = readTuneLibrary(fileURLToPath(new URL('../../lore/Tunes/', import.meta.url)));
const RATE = 22050;
type Waiting = { at: number; spec: PartSpec; group?: string };
const waiting = (engine: Engine): Waiting[] => (engine as unknown as { waiting: Waiting[] }).waiting;

function tone(midi: number, gain = 0.05): Tune {
  return { version: 1, title: `Pitch ${midi}`, bpm: 120, beats: 4, sections: [{ id: 'sound', name: 'Sound', bars: 1, tracks: [{ name: 'Tone', instrument: 'custom', gain, pan: 0, notes: [{ at: 0, midi, duration: 0.25, velocity: 1, patch: { midi, duration: 0.25, beatMs: 500, parts: [{ kind: 'tone', wave: 'sine', freq: hz(midi), gain: 1, bus: 'music', env: { a: 1, d: 80 } }] } }] }] }], arrangement: [{ section: 'sound', repeats: 1 }] };
}

function playSamples(engine: Engine, seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * RATE)), l = new Float32Array(128), r = new Float32Array(128);
  for (let at = 0; at < out.length; at += 128) { engine.render(l, r); out.set(l.subarray(0, Math.min(128, out.length - at)), at); }
  return out;
}
const peak = (samples: Float32Array) => samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);

test('the music library preserves procedural menu and gameplay effects, including their parameters', () => {
  assert.deepEqual(library.cues, {});
  const cues: Cue[] = [
    ...SFX.map(sfx => ({ sfx })),
    { sfx: 'dice.roll', count: 1 }, { sfx: 'dice.roll', count: 3 }, { sfx: 'dice.roll', count: 99 },
    { sfx: 'spell.bolt', element: 'force', ms: 300, count: 1 },
    { sfx: 'spell.bolt', element: 'force', ms: 600, count: 3 },
    { sfx: 'blow.shot', kind: 'bow', ms: 600 }, { sfx: 'blow.shot', kind: 'javelin', ms: 100 },
    { sfx: 'blow.swing', kind: 'hammer' }, { sfx: 'blow.swing', kind: 'bite' },
    { sfx: 'blow.hit', element: 'fire', critical: true }, { sfx: 'blow.hit', kind: 'piercing' },
    { sfx: 'spell.area', element: 'cold', size: 60 }, { sfx: 'world.explosion', size: 30 },
  ];
  for (const seed of [2, 91]) for (const cue of cues) {
    const authored = new Engine(RATE, seed, {}, library), procedural = new Engine(RATE, seed);
    for (const engine of [authored, procedural]) engine.receive({ type: 'sfx', cue });
    assert.deepEqual(waiting(authored), waiting(procedural), JSON.stringify({ seed, cue }));
  }
});

test('procedural menu sounds remain audible and obey the effects volume independently of music', () => {
  const play = (sfxVolume: number) => {
    const engine = new Engine(RATE, 9, {}, library);
    engine.receive({ type: 'volume', volumes: { master: 1, music: 0, sfx: sfxVolume } });
    engine.receive({ type: 'sfx', cue: { sfx: 'ui.choose' } });
    const samples = playSamples(engine, 0.5);
    assert.deepEqual(engine.load, { playing: 0, waiting: 0 });
    return peak(samples);
  };
  assert.ok(play(1) > 0.01);
  assert.equal(play(0), 0);
});

test('scene overrides map, time-of-day changes select another score within the same mood', () => {
  const lib: SoundLibrary = { version: 1, cues: {}, music: { town: 'fallback', fight: 'fallback' }, tunes: { fallback: tone(60), mapDay: tone(62), mapNight: tone(64), sceneNight: tone(65), combat: tone(67) }, maps: { market: { morning: 'mapDay', night: 'mapNight', combat: 'combat' } }, scenes: { meeting: { night: 'sceneNight' } } };
  const engine = new Engine(RATE, 1, {}, lib);
  const select = (context: { map?: string; scene?: string; slot?: string; track?: string }) => {
    engine.receive({ type: 'music', mood: 'town', ...context });
    engine.render(new Float32Array(Math.floor(RATE * 0.25)), new Float32Array(Math.floor(RATE * 0.25)));
    assert.equal(engine.load.waiting, 1);
    return waiting(engine)[0]!.spec.freq;
  };
  assert.equal(select({ map: 'market', scene: 'meeting', slot: 'morning' }), hz(62));
  assert.equal(select({ map: 'market', scene: 'meeting', slot: 'night' }), hz(65));
  assert.equal(select({ map: 'market', slot: 'night' }), hz(64));
  assert.equal(select({ map: 'market', slot: 'next-morning' }), hz(62));
  assert.equal(select({ map: 'market', slot: 'combat' }), hz(67));
  assert.equal(select({ track: 'mapNight' }), hz(64));
  assert.equal(select({}), hz(60));
});

test('cleared vault map slots supersede stale baked assignments while direct tune requests still work', () => {
  const lib: SoundLibrary = { version: 1, cues: {}, music: { town: 'default' }, tunes: { default: tone(60), old: tone(62), scene: tone(64) }, maps: { market: {} }, scenes: { meeting: { night: 'scene' } } };
  const selected = (context: { map?: string; scene?: string; slot?: string; track?: string }) => {
    const engine = new Engine(RATE, 1, {}, lib);
    engine.receive({ type: 'music', mood: 'town', ...context });
    engine.render(new Float32Array(Math.floor(RATE * 0.25)), new Float32Array(Math.floor(RATE * 0.25)));
    return waiting(engine)[0]!.spec.freq;
  };
  assert.equal(selected({ map: 'market', slot: 'night', track: 'old' }), hz(60));
  assert.equal(selected({ map: 'market', scene: 'meeting', slot: 'night', track: 'old' }), hz(64));
  assert.equal(selected({ track: 'old' }), hz(62));
  assert.equal(selected({ map: 'uncompiled-map', slot: 'night', track: 'old' }), hz(62));
});
