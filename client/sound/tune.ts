/** Versioned, portable scores shared by the game and the Obsidian sequencer. Times are beats. */
import { instrumentParts, type MusicInstrument, type Mood } from './music.ts';
import type { PartSpec } from './parts.ts';
export const INSTRUMENTS = ['harp', 'lute', 'flute', 'chip', 'bell', 'bass', 'pulse-bass', 'pad', 'drone', 'drums', 'kick', 'snare', 'hat', 'custom'] as const;
export type TuneInstrument = MusicInstrument | 'drums' | 'custom';
export const INSTRUMENT_LABELS: Record<TuneInstrument, string> = { harp: 'Harp', lute: 'Lute', flute: 'Flute', chip: 'Chip', bell: 'Bell', bass: 'Warm bass', 'pulse-bass': 'Pulse bass', pad: 'Pad', drone: 'Drone', drums: 'Drum kit', kick: 'Kick', snare: 'Snare', hat: 'Hi-hat', custom: 'Custom synth' };
export const DRUM_LANES = [{ midi: 36, instrument: 'kick', label: 'Kick', gain: 0.26 }, { midi: 38, instrument: 'snare', label: 'Snare', gain: 0.1 }, { midi: 42, instrument: 'hat', label: 'Hi-hat', gain: 0.025 }] as const;
/** Nearest lane also makes switching an existing melodic track to drums predictable. */
export function snapDrumPitch(midi: number): number {
  return DRUM_LANES.reduce((nearest, lane) => Math.abs(lane.midi - midi) < Math.abs(nearest.midi - midi) ? lane : nearest, DRUM_LANES[0] as typeof DRUM_LANES[number]).midi;
}
export function drumKind(midi: number): 'kick' | 'snare' | 'hat' { return DRUM_LANES.find(lane => lane.midi === snapDrumPitch(midi))!.instrument; }
export const isPercussion = (kind: TuneInstrument): boolean => kind === 'drums' || kind === 'kick' || kind === 'snare' || kind === 'hat';
export const SCALES = { chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], pentatonic: [0, 2, 4, 7, 9] } as const;
export type TuneKey = { root: number; scale: keyof typeof SCALES };
export function inScale(midi: number, key?: TuneKey): boolean { return !key || (SCALES[key.scale] as readonly number[]).includes(((midi - key.root) % 12 + 12) % 12); }
/** Equidistant notes snap down, consistently for clicks, drags and numeric editing. */
export function snapPitch(midi: number, key?: TuneKey): number {
  const pitch = Math.max(21, Math.min(108, Math.round(midi)));
  for (let distance = 0; distance < 12; distance++) {
    if (pitch - distance >= 21 && inScale(pitch - distance, key)) return pitch - distance;
    if (pitch + distance <= 108 && inScale(pitch + distance, key)) return pitch + distance;
  }
  return pitch;
}
/** Exact synth recipe at a reference pitch/duration. Optional beatMs keeps it in time with tempo edits. */
export interface TunePatch { midi: number; duration: number; beatMs?: number; parts: PartSpec[] }
export interface TuneNote { at: number; midi: number; duration: number; velocity: number; patch?: TunePatch }
export interface TuneTrack { name: string; instrument: TuneInstrument; gain: number; pan: number; notes: TuneNote[]; patch?: TunePatch }
export interface TuneSection { id: string; name: string; bars: number; tracks: TuneTrack[] }
export interface Tune {
  version: 1; title: string; bpm: number; beats: number; key?: TuneKey;
  sections: TuneSection[];
  arrangement: { section: string; repeats: number }[];
  /** Inclusive arrangement indices. The intro plays once; the range repeats indefinitely. */
  loop?: { from: number; to: number };
}
export function parseTune(text: string): Tune {
  if (text.length > 2_000_000) throw new Error('Tune exceeds 2 MB');
  return validateTune(JSON.parse(text));
}
export function validateTune(value: unknown): Tune {
  const fail = (s: string): never => { throw new Error(`Invalid .kmtune: ${s}`); };
  const obj = (v: any, path: string) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path); };
  const num = (v: any, min: number, max: number, path: string, integer = false) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(path);
  };
  const str = (v: any, path: string) => { if (typeof v !== 'string' || !v.trim() || v.length > 120) fail(path); };
  const arr = (v: any, max: number, path: string) => { if (!Array.isArray(v) || v.length > max) fail(path); };
  const t = value as Tune; obj(t, 'root');
  if (t.version !== 1) fail('unsupported version');
  str(t.title, 'title'); num(t.bpm, 30, 300, 'tempo'); num(t.beats, 1, 12, 'beats per bar', true);
  if (t.key !== undefined) { obj(t.key, 'key'); num(t.key.root, 0, 11, 'key root', true); if (!Object.hasOwn(SCALES, t.key.scale)) fail('scale'); }
  const patch = (p: TunePatch) => { obj(p, 'patch'); num(p.midi, 21, 108, 'patch MIDI pitch', true); num(p.duration, 0.001, 64, 'patch duration'); if (p.beatMs !== undefined) num(p.beatMs, 200, 2000, 'patch beat duration'); arr(p.parts, 16, 'patch parts'); if (!p.parts.length) fail('empty patch'); p.parts.forEach(validatePart); };
  arr(t.sections, 64, 'sections'); arr(t.arrangement, 256, 'arrangement');
  if (!t.sections.length || !t.arrangement.length) fail('at least one section and arrangement entry required');
  const ids = new Set<string>(); let notes = 0;
  for (const s of t.sections) {
    obj(s, 'section'); str(s.id, 'section id'); str(s.name, 'section name');
    if (ids.has(s.id)) fail('duplicate section id'); ids.add(s.id);
    num(s.bars, 1, 64, 'section bars', true); arr(s.tracks, 16, 'tracks');
    for (const tr of s.tracks) {
      obj(tr, 'track'); str(tr.name, 'track name');
      if (!INSTRUMENTS.includes(tr.instrument)) fail('instrument');
      if (tr.patch !== undefined) patch(tr.patch);
      num(tr.gain, 0, 1, 'track gain'); num(tr.pan, -1, 1, 'pan'); arr(tr.notes, 4096, 'notes');
      notes += tr.notes.length; if (notes > 20000) fail('too many notes');
      if (tr.instrument === 'custom' && !tr.patch && tr.notes.some(n => !n?.patch)) fail('custom instrument needs a patch');
      const density = new Map<number, number>();
      for (const n of tr.notes) {
        obj(n, 'note'); num(n.at, 0, s.bars * t.beats, 'note start'); num(n.midi, 21, 108, 'MIDI pitch', true);
        num(n.duration, 0.001, 64, 'note duration'); num(n.velocity, 0, 1, 'velocity'); if (n.patch !== undefined) patch(n.patch);
        if (n.at + n.duration > s.bars * t.beats + 1e-8) fail('note extends beyond section');
        const bucket = Math.floor(n.at); const count = (density.get(bucket) ?? 0) + 1;
        if (count > 32) fail('too many notes in one beat'); density.set(bucket, count);
      }
    }
  }
  for (const a of t.arrangement) { obj(a, 'arrangement entry'); if (!ids.has(a.section)) fail('unknown section'); num(a.repeats, 1, 99, 'repeats', true); }
  if (t.loop !== undefined) { obj(t.loop, 'loop'); num(t.loop.from, 0, t.arrangement.length - 1, 'loop start', true); num(t.loop.to, t.loop.from, t.arrangement.length - 1, 'loop end', true); }
  return t;
}
export const writeTune = (t: Tune) => JSON.stringify(validateTune(t), null, 2) + '\n';
export function newTune(): Tune {
  return { version: 1, title: 'New tune', bpm: 96, beats: 4, sections: [{ id: 'intro', name: 'Intro', bars: 2, tracks: [{ name: 'Harp', instrument: 'harp', gain: 0.1, pan: 0, notes: [62, 65, 69, 67].map((midi, i) => ({ midi, at: i * 2, duration: 2, velocity: 0.8 })) }] }], arrangement: [{ section: 'intro', repeats: 2 }] };
}
/** Consolidate old percussion tracks without changing any sounding voice, mixer level or velocity. */
export function mergeDrumTracks(tune: Tune): Tune {
  validateTune(tune);
  const result = structuredClone(tune), beatMs = 60000 / tune.bpm;
  for (const section of result.sections) {
    if (!section.tracks.some(track => track.instrument === 'kick' || track.instrument === 'snare' || track.instrument === 'hat')) continue;
    const sources = section.tracks.filter(track => isPercussion(track.instrument));
    const kit: TuneTrack = { name: sources.find(track => track.instrument === 'drums')?.name ?? 'Drum kit', instrument: 'drums', gain: 1, pan: 0, notes: [] };
    for (const track of sources) for (const note of track.notes) {
      const midi = track.instrument === 'drums' ? snapDrumPitch(note.midi) : DRUM_LANES.find(lane => lane.instrument === track.instrument)!.midi;
      // Resolve both note and track patches before replacing the pitched value with a lane.
      // Velocity remains an independent editable value; track gain/pan become part of the recipe.
      const parts = noteParts(track, { ...note, velocity: 1 }, beatMs);
      kit.notes.push({ ...note, midi, patch: { midi, duration: note.duration, beatMs, parts } });
    }
    kit.notes.sort((a, b) => a.at - b.at || a.midi - b.midi);
    const first = section.tracks.findIndex(track => isPercussion(track.instrument));
    section.tracks = section.tracks.flatMap((track, index) => index === first ? [kit] : isPercussion(track.instrument) ? [] : [track]);
    if (kit.notes.length > 4096) throw new Error(`Cannot merge drums in ${section.name}: the combined track would exceed 4096 notes.`);
    const density = new Map<number, number>();
    for (const note of kit.notes) { const beat = Math.floor(note.at), count = (density.get(beat) ?? 0) + 1; if (count > 32) throw new Error(`Cannot merge drums in ${section.name}: the combined track would exceed 32 notes in one beat.`); density.set(beat, count); }
  }
  validateTune(result);
  if (JSON.stringify(result, null, 2).length + 1 > 2_000_000) throw new Error('Cannot merge drums: the combined tune would exceed 2 MB.');
  return result;
}
/** Note/track edits can share a transport; timing edits require a new one. */
export function canUpdateTune(current: Tune, next: Tune): boolean {
  return current.bpm === next.bpm && current.beats === next.beats
    && current.sections.length === next.sections.length
    && current.sections.every((section, i) => section.id === next.sections[i]!.id && section.bars === next.sections[i]!.bars)
    && current.arrangement.length === next.arrangement.length
    && current.arrangement.every((entry, i) => entry.section === next.arrangement[i]!.section && entry.repeats === next.arrangement[i]!.repeats)
    && current.loop?.from === next.loop?.from && current.loop?.to === next.loop?.to;
}
interface TuneEvent { at: number; spec: PartSpec; beat: number }
interface TunePosition { entry: number; repetition: number; beat: number }
/** Lazy beat scheduler: repeats never expand into a giant event list. */
export class TuneSong {
  private entry = 0; private repetition = 0; private beat = 0; private next: number; private done = false;
  private absoluteBeat = 0; private minimum = -Infinity; private readonly start: number;
  readonly mood: Mood; tune: Tune; private readonly rate: number; readonly group: string;
  constructor(mood: Mood, tune: Tune, start: number, rate: number, group: string) { this.mood = mood; this.tune = tune; this.start = start; this.rate = rate; this.group = group; this.next = start; }
  bars(until: number): TuneEvent[] {
    const out: TuneEvent[] = []; const beatSamples = 60 / this.tune.bpm * this.rate;
    while (!this.done && this.next < until) {
      const entry = this.tune.arrangement[this.entry]!;
      const section = this.tune.sections.find(s => s.id === entry.section)!;
      out.push(...this.notesAt(this.absoluteBeat, { entry: this.entry, repetition: this.repetition, beat: this.beat }));
      this.next = this.start + ++this.absoluteBeat * beatSamples; this.beat++;
      if (this.beat >= section.bars * this.tune.beats) {
        this.beat = 0;
        if (++this.repetition >= entry.repeats) {
          this.repetition = 0;
          if (this.tune.loop && this.entry === this.tune.loop.to) this.entry = this.tune.loop.from;
          else if (++this.entry >= this.tune.arrangement.length) this.done = true;
        }
      }
    }
    return out;
  }

  /** Rewind only lookahead, keeping the original clock and arrangement/loop position. */
  update(tune: Tune, now: number, pendingBeats: readonly number[] = []): TuneEvent[] | undefined {
    validateTune(tune);
    if (!canUpdateTune(this.tune, tune)) return undefined;
    this.tune = tune;
    this.minimum = now;
    this.absoluteBeat = Math.max(0, Math.floor((now - this.start) / (60 / tune.bpm * this.rate)));
    this.next = this.start + this.absoluteBeat * (60 / tune.bpm * this.rate);
    const position = this.position(this.absoluteBeat);
    this.done = !position;
    if (position) { this.entry = position.entry; this.repetition = position.repetition; this.beat = position.beat; }
    // Delayed patch voices may still be queued after their note's beat. Rebuild those too,
    // bounded by the engine's pending queue, without visiting every elapsed loop.
    return [...new Set(pendingBeats)].flatMap(beat => beat < this.absoluteBeat ? this.notesAt(beat, this.position(beat)) : []);
  }

  private notesAt(absoluteBeat: number, position: TunePosition | undefined): TuneEvent[] {
    if (!position) return [];
    const section = this.tune.sections.find(s => s.id === this.tune.arrangement[position.entry]!.section)!;
    const beatSamples = 60 / this.tune.bpm * this.rate, start = this.start + absoluteBeat * beatSamples;
    const out: TuneEvent[] = [];
    for (const track of section.tracks) for (const note of track.notes) if (note.at >= position.beat && note.at < position.beat + 1) {
      for (const spec of noteParts(track, note, 60000 / this.tune.bpm)) {
        const at = start + (note.at - position.beat) * beatSamples + (spec.at ?? 0) * this.rate / 1000;
        if (at >= this.minimum) out.push({ at, spec: { ...spec, at: 0 }, beat: absoluteBeat });
      }
    }
    return out;
  }

  /** Locate a beat in at most one pass over the arrangement, even after hours of looping. */
  private position(absoluteBeat: number): TunePosition | undefined {
    const lengths = this.tune.arrangement.map(entry => this.tune.sections.find(section => section.id === entry.section)!.bars * this.tune.beats);
    let remaining = absoluteBeat;
    if (this.tune.loop) {
      const { from, to } = this.tune.loop;
      const before = lengths.slice(0, from).reduce((sum, beats, i) => sum + beats * this.tune.arrangement[i]!.repeats, 0);
      const cycle = lengths.slice(from, to + 1).reduce((sum, beats, i) => sum + beats * this.tune.arrangement[from + i]!.repeats, 0);
      if (remaining >= before) remaining = before + (remaining - before) % cycle;
    }
    for (let entry = 0; entry < lengths.length; entry++) {
      const length = lengths[entry]!, total = length * this.tune.arrangement[entry]!.repeats;
      if (remaining < total) return { entry, repetition: Math.floor(remaining / length), beat: remaining % length };
      remaining -= total;
    }
    return undefined;
  }
}

/** Validate every DSP parameter before a user-authored recipe reaches the audio thread. */
export function validatePart(value: unknown): asserts value is PartSpec {
  const fail = (path: string): never => { throw new Error(`Invalid .kmtune: patch ${path}`); };
  const object = (v: unknown, name: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(name);
    return v as Record<string, unknown>;
  };
  const number = (o: Record<string, unknown>, key: string, min: number, max: number, required = false) => {
    const n = o[key]; if (n === undefined && !required) return;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) fail(key);
  };
  const keys = (o: Record<string, unknown>, allowed: string[]) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`unknown field ${k}`); };
  const p = object(value, 'part');
  const common = ['kind', 'at', 'env', 'gain', 'pan', 'bus', 'room', 'freq'];
  number(p, 'at', 0, 120000); number(p, 'gain', 0, 4, true); number(p, 'pan', -1, 1); number(p, 'room', 0, 1); number(p, 'freq', 1, 96000, true);
  if (p.bus !== undefined && !['music', 'sfx', 'voice'].includes(String(p.bus))) fail('bus');
  const env = object(p.env, 'envelope'); keys(env, ['a', 'd', 's', 'hold', 'r']);
  for (const key of ['a', 'd', 'hold', 'r']) number(env, key, 0, 120000);
  number(env, 's', 0, 1);
  if (p.kind === 'tone') {
    keys(p, [...common, 'wave', 'to', 'glide', 'duty', 'vib', 'detune', 'fm', 'lp', 'lpTo', 'sweep', 'q', 'hp']);
    if (!['sine', 'triangle', 'square', 'pulse', 'saw'].includes(String(p.wave))) fail('wave');
    for (const key of ['to', 'lp', 'lpTo', 'hp']) number(p, key, 1, 96000);
    for (const key of ['glide', 'sweep']) number(p, key, 0, 120000);
    number(p, 'duty', 0.01, 0.99); number(p, 'detune', 0, 1200); number(p, 'q', 0.05, 30);
    if (p.vib !== undefined) {
      const v = object(p.vib, 'vibrato'); keys(v, ['rate', 'depth', 'after']);
      number(v, 'rate', 0, 100, true); number(v, 'depth', 0, 24, true); number(v, 'after', 0, 120000);
    }
    if (p.fm !== undefined) {
      const fm = object(p.fm, 'FM'); keys(fm, ['ratio', 'index', 'fall']);
      number(fm, 'ratio', 0, 100, true); number(fm, 'index', 0, 100, true); number(fm, 'fall', 0, 120000);
    }
  } else if (p.kind === 'noise') {
    keys(p, [...common, 'filter', 'to', 'sweep', 'q', 'grain', 'crackle']);
    if (!['lp', 'bp', 'hp'].includes(String(p.filter))) fail('noise filter');
    number(p, 'to', 1, 96000); number(p, 'sweep', 0, 120000); number(p, 'q', 0.05, 30);
    number(p, 'grain', 0, 96000); number(p, 'crackle', 0, 96000);
  } else if (p.kind === 'pluck') {
    keys(p, [...common, 'decay', 'bright']); number(p, 'decay', 0.001, 120, true); number(p, 'bright', 0, 1);
  } else fail('part kind');
}

/** A note can contain several voices; exported recipes stay editable and sound exactly as before. */
export function noteParts(track: TuneTrack, note: TuneNote, beatMs: number): PartSpec[] {
  const candidate = note.patch ?? track.patch;
  // An imported recipe belongs to its drum lane. Moving to another lane plays that drum;
  // moving back restores the original recipe instead of transposing a kick into a snare.
  const patch = track.instrument === 'drums' && candidate && drumKind(note.midi) !== drumKind(candidate.midi) ? undefined : candidate;
  if (!patch) {
    if (track.instrument === 'custom') return [];
    const lane = track.instrument === 'drums' ? DRUM_LANES.find(lane => lane.midi === snapDrumPitch(note.midi)) : undefined;
    const kind = track.instrument === 'drums' ? drumKind(note.midi) : track.instrument;
    return instrumentParts(kind, note.midi, note.duration, track.gain * note.velocity * (lane?.gain ?? 1), track.pan, beatMs);
  }
  const ratio = track.instrument === 'drums' ? 1 : 2 ** ((note.midi - patch.midi) / 12);
  const stretch = note.duration / patch.duration * beatMs / (patch.beatMs ?? beatMs);
  return patch.parts.map(part => {
    const result = { ...part, env: { ...part.env }, ...(part.kind === 'tone' && part.vib ? { vib: { ...part.vib } } : {}), ...(part.kind === 'tone' && part.fm ? { fm: { ...part.fm } } : {}) } as PartSpec;
    result.gain *= track.gain * note.velocity;
    result.pan = Math.max(-1, Math.min(1, (part.pan ?? 0) + track.pan));
    if (result.at !== undefined) result.at *= stretch;
    for (const key of ['a', 'd', 'hold', 'r'] as const) if (result.env[key] !== undefined) result.env[key]! *= stretch;
    if (result.kind !== 'noise') result.freq *= ratio;
    if (result.kind === 'tone') {
      if (result.to !== undefined) result.to *= ratio;
      if (result.glide !== undefined) result.glide *= stretch;
      if (result.sweep !== undefined) result.sweep *= stretch;
      if (result.vib?.after !== undefined) result.vib.after *= stretch;
      if (result.fm?.fall !== undefined) result.fm.fall *= stretch;
    } else if (result.kind === 'noise') { if (result.sweep !== undefined) result.sweep *= stretch; }
    else result.decay *= stretch;
    return result;
  });
}
