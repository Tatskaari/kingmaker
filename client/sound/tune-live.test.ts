import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from './engine.ts';
import { canUpdateTune, newTune, TuneSong, type Tune } from './tune.ts';

function score(): Tune {
  const tune = newTune(); tune.bpm = 120;
  const section = tune.sections[0]!; section.bars = 1;
  section.tracks[0]!.notes = [0, 1, 2, 3].map(at => ({ at, midi: 60 + at, duration: 0.5, velocity: 1 }));
  tune.arrangement = [{ section: section.id, repeats: 2 }];
  tune.loop = { from: 0, to: 0 };
  return tune;
}

function render(engine: Engine, samples: number): Float32Array {
  const output = new Float32Array(samples);
  for (let from = 0; from < samples; from += 128) {
    const left = output.subarray(from, Math.min(samples, from + 128)), right = new Float32Array(left.length);
    engine.render(left, right);
  }
  return output;
}

test('live edits allow notes, tracks and metadata while protecting transport structure', () => {
  const original = score(), edited = structuredClone(original);
  edited.title = 'Edited'; edited.key = { root: 2, scale: 'dorian' };
  edited.sections[0]!.name = 'Renamed'; edited.sections[0]!.tracks = [];
  assert.equal(canUpdateTune(original, edited), true);
  const changes: ((tune: Tune) => void)[] = [
    tune => tune.bpm++, tune => tune.beats++, tune => tune.sections[0]!.bars++,
    tune => tune.arrangement[0]!.repeats++, tune => { delete tune.loop; },
    tune => { tune.sections[0]!.id = 'other'; tune.arrangement[0]!.section = 'other'; },
  ];
  for (const change of changes) {
    const next = structuredClone(original); change(next);
    assert.equal(canUpdateTune(original, next), false);
  }
});

test('moving, deleting and adding queued notes sounds exactly like the edited score at the original phase', () => {
  const original = score(), edited = structuredClone(original), notes = edited.sections[0]!.tracks[0]!.notes;
  notes[1]!.at = 1.5; notes[1]!.midi = 72;
  notes.splice(2, 1); notes.push({ at: 2.75, midi: 67, duration: 0.25, velocity: 0.7 });
  const live = new Engine(22050, 4), reference = new Engine(22050, 4);
  live.receive({ type: 'music', mood: 'title', tune: original });
  reference.receive({ type: 'music', mood: 'title', tune: edited });
  assert.deepEqual(render(live, 17640), render(reference, 17640));
  assert.ok(live.load.waiting > 0, 'lookahead already queued the note being moved');
  live.receive({ type: 'tune-update', tune: edited });
  assert.equal(live.time, 17640);
  assert.deepEqual(render(live, 22050 * 6), render(reference, 22050 * 6));
});

test('live edits keep sounding tails, including when every note is deleted', () => {
  const original = score(); delete original.loop;
  original.arrangement[0]!.repeats = 1;
  original.sections[0]!.tracks[0]!.notes = [{ at: 0, midi: 60, duration: 3, velocity: 1 }];
  const live = new Engine(22050, 7), reference = new Engine(22050, 7);
  for (const engine of [live, reference]) engine.receive({ type: 'music', mood: 'title', tune: original });
  assert.deepEqual(render(live, 17640), render(reference, 17640));
  const empty = structuredClone(original); empty.sections[0]!.tracks = [];
  live.receive({ type: 'tune-update', tune: empty });
  assert.deepEqual(render(live, 22050), render(reference, 22050));
});

test('delayed patch voices are rebuilt without restarting their already sounding voices', () => {
  const original = score(); delete original.loop; original.arrangement[0]!.repeats = 1;
  const track = original.sections[0]!.tracks[0]!;
  track.notes = [{ at: 0, midi: 60, duration: 1, velocity: 1, patch: { midi: 60, duration: 1, parts: [
    { kind: 'tone', wave: 'sine', freq: 261, gain: 0.1, bus: 'music', env: { hold: 700, r: 200 } },
    { kind: 'tone', wave: 'sine', freq: 522, gain: 0.1, bus: 'music', at: 1300, env: { hold: 200, r: 100 } },
  ] } }];
  const edited = structuredClone(original); edited.sections[0]!.tracks[0]!.notes[0]!.patch!.parts[1]!.freq = 783;
  const live = new Engine(22050, 3), reference = new Engine(22050, 3);
  live.receive({ type: 'music', mood: 'title', tune: original }); reference.receive({ type: 'music', mood: 'title', tune: edited });
  assert.deepEqual(render(live, 26460), render(reference, 26460));
  live.receive({ type: 'tune-update', tune: edited });
  assert.deepEqual(render(live, 22050 * 2), render(reference, 22050 * 2));
});

test('seeking a long-running loop keeps intro, repeats and loop phase without scanning elapsed beats', () => {
  const tune = score(); tune.bpm = 60;
  const second = structuredClone(tune.sections[0]!); second.id = 'second'; second.tracks[0]!.notes = [{ at: 0.5, midi: 72, duration: 0.5, velocity: 1 }];
  tune.sections.push(second); tune.arrangement.push({ section: 'second', repeats: 3 }); tune.loop = { from: 1, to: 1 };
  const song = new TuneSong('title', tune, 100, 1000, 'same-group');
  song.bars(20000);
  const edited = structuredClone(tune); edited.sections[1]!.tracks[0]!.instrument = 'bell'; edited.sections[1]!.tracks[0]!.gain = 0.2;
  // Intro is 8 beats; the 12-beat loop is still in its second repetition here.
  const now = 100 + (8 + 12 * 100000000 + 4) * 1000 + 250;
  assert.deepEqual(song.update(edited, now), []);
  const notes = song.bars(now + 5000);
  assert.deepEqual(notes.map(note => note.at), [now + 250, now + 4250]);
  assert.equal(song.group, 'same-group'); assert.equal(song.mood, 'title');
  assert.equal(notes[0]!.spec.kind, 'tone'); assert.equal(notes[0]!.spec.gain, notes[1]!.spec.gain);
});

test('a finite score whose last beat was scheduled can still be edited before playback ends', () => {
  const tune = score(); delete tune.loop; tune.arrangement[0]!.repeats = 1;
  const song = new TuneSong('title', tune, 0, 1000, 'finite');
  song.bars(1900);
  const edited = structuredClone(tune); edited.sections[0]!.tracks[0]!.notes[3]!.at = 3.5;
  assert.deepEqual(song.update(edited, 1600), []);
  assert.deepEqual(song.bars(1900).map(note => note.at), [1750]);
  song.update(edited, 2500); assert.deepEqual(song.bars(10000), []);
});
