import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOODS, Song, STYLES } from '../../client/sound/music.ts';
import type { PartSpec } from '../../client/sound/parts.ts';
import { parseTune, TuneSong, writeTune, type Tune } from '../../client/sound/tune.ts';
import { exportLibrary, scoreSeed, writeLibrary } from './export.ts';

const library = exportLibrary();

function scheduled(tune: Tune): Array<{ at: number; spec: PartSpec }> {
  const finite = structuredClone(tune); delete finite.loop;
  return new TuneSong('title', finite, 0, 1000, 'test').bars(1e9);
}

function canonical(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

function fingerprints(events: Array<{ at: number; spec: PartSpec }>): string[] {
  return events.map(e => {
    const { at: offset = 0, ...spec } = e.spec;
    return JSON.stringify(canonical({ at: Math.max(0, e.at + offset), spec: { ...spec, pan: spec.pan ?? 0, bus: spec.bus ?? 'sfx' } }));
  }).sort();
}

test('exports only the seven music moods as deterministic, portable scores', () => {
  assert.deepEqual(exportLibrary(), library);
  assert.deepEqual(Object.keys(library.tunes).sort(), [...MOODS].sort());
  for (const mood of MOODS) assert.ok(library.tunes[library.catalog.music[mood]]);
  assert.deepEqual(library.catalog.cues, {}, 'menu and gameplay effects keep their procedural recipes');
  for (const tune of Object.values(library.tunes)) assert.deepEqual(parseTune(writeTune(tune)), tune);
  const instruments = new Set(Object.values(library.tunes).flatMap(t => t.sections.flatMap(s => s.tracks.map(tr => tr.instrument))));
  for (const name of ['harp', 'lute', 'flute', 'chip', 'bell', 'bass', 'pulse-bass', 'pad', 'drone', 'drums']) assert.ok(instruments.has(name as never), name);
  for (const name of ['kick', 'snare', 'hat']) assert.ok(!instruments.has(name as never), `${name} belongs in the drum kit`);
  for (const tune of Object.values(library.tunes)) for (const section of tune.sections) {
    const drums = section.tracks.filter(track => track.instrument === 'drums');
    assert.ok(drums.length <= 1, 'each section uses one drum kit');
    for (const drum of drums) assert.ok(drum.notes.every(note => [36, 38, 42].includes(note.midi)));
  }
});

for (const mood of MOODS) test(`${mood}: exported notes retain the original timing and synth recipes`, () => {
  const tune = library.tunes[mood]!, style = STYLES[mood];
  const duration = style.hold * 4 * style.beats * 4 * 60000 / style.bpm;
  const original = new Song(mood, scoreSeed(mood), 0, 1000, 'test').bars(duration - 0.01);
  assert.deepEqual(fingerprints(scheduled(tune)), fingerprints(original));
  assert.deepEqual(tune.loop, { from: 1, to: 3 });
});

test('regeneration refuses to overwrite composer edits before writing any files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kingmaker-tunes-export-'));
  try {
    await writeFile(join(directory, 'title.kmtune'), 'my composition');
    await assert.rejects(writeLibrary(directory), /Refusing to replace/);
    assert.equal(await readFile(join(directory, 'title.kmtune'), 'utf8'), 'my composition');
    assert.deepEqual(await readdir(directory), ['title.kmtune']);
    assert.equal(await writeLibrary(directory, true), 8);
    assert.deepEqual((await readdir(directory)).sort(), ['catalog.json', ...MOODS.map(mood => `${mood}.kmtune`)].sort());
    assert.deepEqual(parseTune(await readFile(join(directory, 'title.kmtune'), 'utf8')), library.tunes.title);
    await assert.rejects(writeLibrary(directory), /Refusing to replace/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scores store engine references without per-note or per-track synth definitions', () => {
  for (const tune of Object.values(library.tunes)) for (const section of tune.sections) for (const track of section.tracks) {
    assert.notEqual(track.instrument, 'custom');
    assert.equal(track.patch, undefined);
    for (const note of track.notes) assert.equal(note.patch, undefined);
    const text = writeTune(tune);
    assert.ok(text.split('\n').filter(line => line.includes('"velocity"')).every(line => line.trim().startsWith('{') && line.includes('"midi"')), 'each note is a reviewable single line');
    assert.deepEqual(parseTune(text), tune);
  }
});

test('legacy conversion preserves authored notes and musical expression without regenerating them', async () => {
  const { useEngineInstruments } = await import('./migrate.ts');
  const { newTune, noteParts } = await import('../../client/sound/tune.ts');
  const source = newTune(); source.title = 'My edited score';
  const track = source.sections[0]!.tracks[0]!;
  track.notes[0]!.pan = -0.2;
  for (const note of track.notes) {
    note.patch = { midi: note.midi, duration: note.duration, beatMs: 60000 / source.bpm,
      parts: noteParts({ ...track, gain: 1, pan: 0 }, { ...note, velocity: 1, pan: undefined }, 60000 / source.bpm) };
  }
  assert.deepEqual(fingerprints(scheduled(useEngineInstruments(source))), fingerprints(scheduled(source)), 'unchanged presets sound the same');
  // Simulate the composer's edits after export, including a copied extra note and a repeat change.
  track.notes[0]!.midi += 7; track.notes[1]!.duration = 0.5;
  track.notes.push({ ...structuredClone(track.notes[1]!), at: 7, velocity: 0.45 });
  source.arrangement[0]!.repeats = 3;
  const before = structuredClone(source), migrated = useEngineInstruments(source);
  assert.deepEqual(source, before, 'migration does not mutate the original');
  assert.deepEqual(migrated.arrangement, source.arrangement);
  assert.equal(migrated.title, source.title);
  const fields = (tune: Tune) => tune.sections.flatMap(s => s.tracks.flatMap(t => t.notes.map(n => ({ at: n.at, midi: n.midi, duration: n.duration }))));
  assert.deepEqual(fields(migrated), fields(source));
  const performance = (tune: Tune) => scheduled(tune).map(({ at, spec }) => JSON.stringify(canonical({ at, freq: spec.freq, gain: spec.gain, pan: spec.pan ?? 0 }))).sort();
  assert.deepEqual(performance(migrated), performance(source), 'pitches, onsets, dynamics and pan survive edits');
  assert.equal((noteParts(migrated.sections[0]!.tracks[0]!, migrated.sections[0]!.tracks[0]!.notes[1]!, 60000 / source.bpm)[0] as {decay: number}).decay, 2.2, 'edited lengths use the engine harp’s natural decay');
  assert.deepEqual(useEngineInstruments(migrated), migrated);
  assert.ok(migrated.sections[0]!.tracks[0]!.notes.every(n => !n.patch));
  track.notes[0]!.patch!.parts[0]!.room = 0.99;
  assert.throws(() => useEngineInstruments(source), /custom harp recipe/);
});
