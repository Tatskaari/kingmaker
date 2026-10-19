import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRUM_LANES, drumKind, isPercussion, mergeDrumTracks, newTune, noteParts, parseTune, snapDrumPitch, validateTune, writeTune, TuneSong, type Tune, type TuneTrack } from './tune.ts';
import { instrumentParts } from './music.ts';
import { Engine } from './engine.ts';
function score(): Tune {
  const t = newTune(); t.bpm = 60;
  t.sections[0]!.bars = 1; t.sections[0]!.tracks[0]!.notes = [{ at: 0, midi: 60, duration: 1, velocity: 1 }];
  t.sections.push({ ...structuredClone(t.sections[0]!), id: 'b', name: 'B' });
  t.sections[1]!.tracks[0]!.notes[0]!.midi = 72;
  t.arrangement = [{ section: 'intro', repeats: 2 }, { section: 'b', repeats: 3 }];
  return t;
}
test('scores round trip, including repeated sections', () => { const t = score(); assert.deepEqual(parseTune(writeTune(t)), t); });
test('scheduler repeats sections exactly, ends, and is independent of block size', () => {
  const t = score(), song = new TuneSong('title', t, 100, 1000, 'test');
  const notes = song.bars(30000); assert.deepEqual(notes.map(n => n.at), [100, 4100, 8100, 12100, 16100]);
  assert.deepEqual(song.bars(60000), []);
  const small = new TuneSong('title', t, 100, 1000, 'test');
  const batched = []; for (let i = 0; i <= 30000; i += 128) batched.push(...small.bars(i));
  assert.deepEqual(batched, notes);
});
test('intro once then loop range, with repeats inside each pass', () => {
  const t = score(); t.loop = { from: 1, to: 1 };
  const song = new TuneSong('title', t, 0, 1000, 'test');
  const notes = song.bars(29000); assert.deepEqual(notes.map(n => n.at), [0, 4000, 8000, 12000, 16000, 20000, 24000, 28000]);
  assert.notDeepEqual(notes[0]!.spec, notes[2]!.spec); assert.deepEqual(notes[2]!.spec, notes[7]!.spec);
});
test('invalid files fail before playback', () => {
  const changes: ((t: any) => void)[] = [t => t.version = 2, t => t.bpm = 0, t => t.sections = [], t => t.sections.push(t.sections[0]), t => t.arrangement[0].repeats = 0, t => t.arrangement[0].repeats = 1.5, t => t.arrangement[0].section = 'missing', t => t.loop = { from: 2, to: 0 }, t => t.sections[0].tracks[0].notes[0].duration = 50, t => t.sections[0].tracks[0].notes[0].midi = 999, t => t.sections[0].tracks[0].gain = 10, t => t.sections[0].tracks[0].instrument = 'unknown'];
  for (const change of changes) { const t = score(); change(t); assert.throws(() => parseTune(JSON.stringify(t)), /Invalid/); }
  assert.throws(() => parseTune('{broken'));
});
test('authored music renders through engine, bus mute works, mood change clears it', () => {
  const t = score(); t.loop = { from: 0, to: 1 };
  const engine = new Engine(22050, 1, { title: t }); engine.receive({ type: 'music', mood: 'title' });
  const l = new Float32Array(128), r = new Float32Array(128); let peak = 0;
  for (let i = 0; i < 400; i++) { engine.render(l, r); for (const v of l) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); } }
  assert.ok(peak > 0.01 && peak < 0.98);
  engine.receive({ type: 'music', mood: null });
  for (let i = 0; i < 2200; i++) engine.render(l, r);
  assert.deepEqual(engine.load, { playing: 0, waiting: 0 }); assert.ok(l.every(v => Math.abs(v) < 0.001));
  const quiet = new Engine(22050, 1); quiet.receive({ type: 'volume', volumes: { music: 0 } }); quiet.receive({ type: 'music', mood: 'title', tune: t });
  for (let i = 0; i < 400; i++) { quiet.render(l, r); assert.ok(l.every(v => v === 0)); }
});

test('all instruments render, including both layers of the kick', async () => {
  const { INSTRUMENTS, noteParts } = await import('./tune.ts');
  for (const instrument of INSTRUMENTS.filter(kind => kind !== 'custom')) {
    const t = score(), track = t.sections[0]!.tracks[0]!; track.instrument = instrument;
    const parts = noteParts(track, track.notes[0]!, 1000);
    assert.equal(parts.length, instrument === 'kick' ? 2 : 1);
    assert.ok(parts.every(part => part.bus === 'music' && Number.isFinite(part.freq)));
    const engine = new Engine(22050, 1); engine.receive({ type: 'music', mood: 'title', tune: t });
    const left = new Float32Array(128), right = new Float32Array(128); let peak = 0;
    for (let i = 0; i < 300; i++) { engine.render(left, right); for (const value of left) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); } }
    assert.ok(peak > 0, `${instrument} produces audio`);
  }
});

test('exact recipes support delayed voices, transposition, tempo and duration edits without mutating the source', async () => {
  const { noteParts } = await import('./tune.ts');
  const t = score(), track = t.sections[0]!.tracks[0]!, n = track.notes[0]!;
  track.instrument = 'custom'; track.gain = 1; track.pan = 0;
  n.patch = { midi: 60, duration: 1, beatMs: 1000, parts: [
    { kind: 'tone', wave: 'pulse', freq: 261, to: 522, glide: 80, gain: 0.1, pan: -0.2, bus: 'music', env: { a: 2, hold: 100 }, vib: { rate: 5, depth: 0.2, after: 50 }, fm: { ratio: 2, index: 1, fall: 40 } },
    { kind: 'noise', filter: 'hp', freq: 4000, gain: 0.04, bus: 'music', at: 50, env: { d: 40 } },
  ] };
  assert.deepEqual(noteParts(track, n, 1000), n.patch.parts.map(part => ({ ...part, pan: part.pan ?? 0 })));
  assert.deepEqual(new TuneSong('title', t, 0, 1000, 'test').bars(1).map(event => event.at), [0, 50]);
  const before = JSON.stringify(n.patch), parts = noteParts(track, { ...n, midi: 72, duration: 2 }, 500);
  assert.equal(parts[0]!.freq, 522); assert.equal(parts[1]!.freq, 4000);
  assert.equal(parts[0]!.env.hold, 100); assert.equal(JSON.stringify(n.patch), before);
  const stretched = noteParts(track, { ...n, duration: 2 }, 1000);
  assert.equal(stretched[1]!.at, 100); assert.equal(stretched[0]!.env.hold, 200);
});

test('malformed sound recipes and scale metadata fail before audio playback', async () => {
  const { validateTune } = await import('./tune.ts');
  const changes: ((part: any) => void)[] = [p => p.freq = Infinity, p => p.freq = 0, p => p.gain = -1, p => p.env.a = NaN, p => p.env.s = 2, p => p.wave = 'unknown', p => p.vib = { rate: -1, depth: 1 }, p => p.fm = { ratio: 1, index: 101 }, p => p.bus = 'unknown', p => p.unrecognised = true, p => p.at = -50, p => p.lp = -1, p => p.duty = 1];
  for (const change of changes) {
    const t = score(); const part: any = { kind: 'tone', wave: 'sine', freq: 440, gain: 0.1, env: {} }; change(part);
    t.sections[0]!.tracks[0]!.notes[0]!.patch = { midi: 60, duration: 1, parts: [part] };
    assert.throws(() => validateTune(t), /Invalid .kmtune: patch/);
  }
  const t = score(); t.key = { root: 12, scale: 'major' }; assert.throws(() => validateTune(t), /key root/);
  t.key = { root: 0, scale: 'unknown' as any }; assert.throws(() => validateTune(t), /scale/);
});

test('scale constraints snap to the chosen root and mode, preserve chromatic scores and stay in MIDI range', async () => {
  const { snapPitch, inScale, SCALES } = await import('./tune.ts');
  assert.equal(snapPitch(61), 61); assert.equal(snapPitch(61, { root: 0, scale: 'major' }), 60);
  assert.equal(snapPitch(61, { root: 2, scale: 'dorian' }), 60);
  for (const scale of Object.keys(SCALES) as (keyof typeof SCALES)[]) for (let root = 0; root < 12; root++) for (let midi = 21; midi <= 108; midi++) {
    const result = snapPitch(midi, { root, scale }); assert.ok(inScale(result, { root, scale })); assert.ok(result >= 21 && result <= 108);
  }
  const t = score(); t.key = { root: 2, scale: 'dorian' }; assert.deepEqual(parseTune(writeTune(t)).key, t.key);
});

test('one drum kit routes each labelled lane to its full percussion recipe', () => {
  const track: TuneTrack = { name: 'Kit', instrument: 'drums', gain: 0.12, pan: -0.3, notes: [] };
  for (const lane of DRUM_LANES) {
    const note = { at: 0, midi: lane.midi, duration: 0.25, velocity: 0.7 };
    assert.deepEqual(noteParts(track, note, 625), instrumentParts(lane.instrument, note.midi, note.duration, track.gain * note.velocity * lane.gain, track.pan, 625));
    assert.equal(drumKind(lane.midi), lane.instrument);
  }
  assert.ok(isPercussion('drums')); assert.equal(snapDrumPitch(37), 36); assert.equal(snapDrumPitch(40), 38);
  assert.equal(snapDrumPitch(21), 36); assert.equal(snapDrumPitch(108), 42);
});

function eventRecipes(tune: Tune): string[] {
  const finite = structuredClone(tune); delete finite.loop;
  const canonical = (value: any): any => typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return new TuneSong('title', finite, 0, 1000, 'test').bars(30000).map(event => JSON.stringify(canonical(event))).sort();
}

test('merging legacy drums retains every voice, onset, velocity, custom recipe and mixer setting', () => {
  const tune = newTune(), section = tune.sections[0]!;
  const note = { at: 0.25, midi: 60, duration: 0.5, velocity: 0.35 };
  const kick: TuneTrack = { name: 'Low drum', instrument: 'kick', gain: 0.2, pan: -0.6, notes: [{ ...note }, { ...note, at: 1.5, velocity: 0 }] };
  const snare: TuneTrack = { name: 'Snare', instrument: 'snare', gain: 0.07, pan: 0.8, notes: [{ ...note, at: 0.75, velocity: 0.9 }], patch: { midi: 48, duration: 0.25, beatMs: 500, parts: [{ kind: 'tone', wave: 'sine', freq: 210, to: 85, glide: 30, gain: 0.6, pan: 0.4, at: 13, env: { a: 3, d: 20, r: 40 }, bus: 'music' }] } };
  const hat: TuneTrack = { name: 'Muted hat', instrument: 'hat', gain: 0, pan: 0.5, notes: [{ ...note, at: 1.75 }] };
  const kit: TuneTrack = { name: 'My drums', instrument: 'drums', gain: 0.15, pan: 0.2, notes: [{ ...note, at: 2.25, midi: 42 }] };
  section.tracks.splice(0, 0, kick, kit); section.tracks.push(snare, hat);
  const original = structuredClone(tune), merged = mergeDrumTracks(tune), tracks = merged.sections[0]!.tracks;
  assert.deepEqual(tune, original); assert.deepEqual(eventRecipes(merged), eventRecipes(tune));
  assert.deepEqual(tracks.map(track => track.instrument), ['drums', 'harp']);
  assert.equal(tracks[0]!.name, 'My drums'); assert.equal(tracks[0]!.gain, 1); assert.equal(tracks[0]!.pan, 0);
  assert.deepEqual(tracks[0]!.notes.map(n => [n.midi, n.velocity]), [[36, 0.35], [38, 0.9], [36, 0], [42, 0.35], [42, 0.35]]);
  assert.deepEqual(parseTune(writeTune(merged)), merged);
  assert.deepEqual(mergeDrumTracks(merged), merged);
  tracks[1]!.name = 'Changed'; assert.equal(tune.sections[0]!.tracks[2]!.name, 'Harp');
});

test('moving an imported drum between lanes plays the destination sound and restores its recipe on return', () => {
  const tune = newTune(), track = tune.sections[0]!.tracks[0]!;
  track.instrument = 'kick'; track.notes = [{ at: 0, midi: 60, duration: 0.25, velocity: 0.8 }];
  const kit = mergeDrumTracks(tune).sections[0]!.tracks[0]!, note = kit.notes[0]!;
  const kick = noteParts(kit, note, 625);
  assert.deepEqual(noteParts(kit, { ...note, midi: 38 }, 625), instrumentParts('snare', 38, note.duration, kit.gain * note.velocity * DRUM_LANES[1].gain, kit.pan, 625));
  assert.deepEqual(noteParts(kit, { ...note, midi: 37 }, 625), kick);
  assert.deepEqual(noteParts(kit, note, 625), kick);
});

test('drum consolidation refuses density and size overflow without dropping notes or mutating the source', () => {
  const dense = newTune(), section = dense.sections[0]!;
  section.tracks = ['kick', 'hat'].map(instrument => ({ name: instrument, instrument: instrument as 'kick' | 'hat', gain: 0.1, pan: 0, notes: Array.from({ length: 17 }, (_, i) => ({ at: i / 32, duration: 0.01, velocity: 1, midi: 60 })) }));
  validateTune(dense); const original = structuredClone(dense);
  assert.throws(() => mergeDrumTracks(dense), /32 notes in one beat/); assert.deepEqual(dense, original);
  dense.beats = 12; section.bars = 64;
  for (const track of section.tracks) track.notes = Array.from({ length: 2100 }, (_, i) => ({ at: i / 4, duration: 0.1, velocity: 1, midi: 60 }));
  validateTune(dense); assert.throws(() => mergeDrumTracks(dense), /4096 notes/);
});
