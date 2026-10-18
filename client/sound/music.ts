// New: the game's music, composed as it plays (docs/sound-design.md): a mood names a style (its mode, tempo and band: a harp, a lute, a recorder, a pad, a drum), and a song in it is made a bar at a time from a seed, its chords from the style's progressions and its tunes from motifs that come back changed, so it never loops the same way twice and needs no recording.
import { hz, rng } from "./dsp.ts";
import type { PartSpec } from "./parts.ts";

/** The music's moods: the title, the town by day and by night, a scene's talk, between scenes, a fight, The End. */
export const MOODS = ["title", "town", "night", "scene", "between", "fight", "end"] as const;
export type Mood = (typeof MOODS)[number];

type Instrument = "harp" | "lute" | "flute" | "chip" | "bell";

/** How a mood's music goes. */
interface Style {
  bpm: number;
  beats: number;
  /** The tonic, as a MIDI note, where the bass plays it. */
  root: number;
  /** The scale: its semitones above the tonic. */
  mode: number[];
  /** Chords as the scale's degrees (0 the tonic), four to a section; one progression a section. */
  progressions: number[][];
  /** Bars a chord lasts. */
  hold: number;
  /** Eighth notes' lilt: 0.5 straight, more for a swing. */
  swing?: number;
  bass?: { kind: "root" | "fifths" | "pump"; gain: number; wave?: "triangle" | "pulse" };
  arp?: { instrument: Instrument; pattern: number[]; per: number; octave: number; gain: number };
  /** Oom-pah on a lute: the bass on one and three, the chord on two and four. */
  strum?: { gain: number };
  pad?: { gain: number; octave: number };
  melody?: { instrument: Instrument; octave: number; gain: number; rests: number };
  drums?: { gain: number };
  drone?: { gain: number };
  bells?: { gain: number; chance: number };
}

const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

export const STYLES: Record<Mood, Style> = {
  // D Dorian: a harp's broken chords under a recorder, steady and a little grand.
  title: {
    bpm: 76, beats: 4, root: 38, mode: DORIAN, hold: 1,
    progressions: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 2, 6, 3], [0, 4, 6, 3]],
    bass: { kind: "fifths", gain: 0.11 }, arp: { instrument: "harp", pattern: [0, 1, 2, 3, 2, 1, 2, 1], per: 2, octave: 24, gain: 0.07 },
    pad: { gain: 0.016, octave: 12 }, melody: { instrument: "flute", octave: 36, gain: 0.07, rests: 0.25 },
  },
  // G Mixolydian: a lute's oom-pah, a swing, a tune on top: a market morning.
  town: {
    bpm: 100, beats: 4, root: 43, mode: MIXOLYDIAN, hold: 1, swing: 0.58,
    progressions: [[0, 6, 3, 0], [0, 3, 6, 0], [0, 0, 6, 3], [0, 3, 4, 0]],
    strum: { gain: 0.12 }, melody: { instrument: "flute", octave: 36, gain: 0.08, rests: 0.3 },
    pad: { gain: 0.016, octave: 12 },
  },
  // A Aeolian, slow: a drone, a harp now and then, bells in the dark.
  night: {
    bpm: 62, beats: 4, root: 45, mode: AEOLIAN, hold: 2,
    progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 5, 3, 4]],
    arp: { instrument: "harp", pattern: [0, 2, 1, 3], per: 1, octave: 12, gain: 0.05 },
    pad: { gain: 0.016, octave: 12 }, drone: { gain: 0.04 }, bells: { gain: 0.025, chance: 0.12 },
  },
  // A Dorian, sparse and low, under the talk: so the voices sit on top of it.
  scene: {
    bpm: 66, beats: 4, root: 45, mode: DORIAN, hold: 2,
    progressions: [[0, 3, 0, 6], [0, 2, 3, 0], [0, 6, 2, 3]],
    arp: { instrument: "harp", pattern: [0, 2, 1, 2], per: 1, octave: 0, gain: 0.045 },
    pad: { gain: 0.013, octave: 12 }, bass: { kind: "root", gain: 0.07 },
  },
  // D Dorian again, gentler: the walk between scenes.
  between: {
    bpm: 70, beats: 4, root: 38, mode: DORIAN, hold: 1,
    progressions: [[0, 6, 3, 0], [0, 2, 3, 6]],
    arp: { instrument: "harp", pattern: [0, 1, 2, 3], per: 2, octave: 24, gain: 0.055 },
    pad: { gain: 0.014, octave: 12 }, bass: { kind: "root", gain: 0.08 },
    melody: { instrument: "bell", octave: 36, gain: 0.035, rests: 0.5 },
  },
  // E Phrygian, quick: a pumping bass, drums, a chip tune, stabs on the lute.
  fight: {
    bpm: 138, beats: 4, root: 40, mode: PHRYGIAN, hold: 1,
    progressions: [[0, 1, 0, 6], [0, 5, 6, 0], [0, 1, 2, 1]],
    bass: { kind: "pump", gain: 0.085, wave: "pulse" }, drums: { gain: 1 },
    arp: { instrument: "lute", pattern: [0, 2, 1, 2], per: 2, octave: 12, gain: 0.05 },
    melody: { instrument: "chip", octave: 24, gain: 0.045, rests: 0.2 },
  },
  // F Lydian: warm and wide, a recorder over the harp.
  end: {
    bpm: 72, beats: 4, root: 41, mode: LYDIAN, hold: 1,
    progressions: [[0, 1, 0, 1], [0, 1, 5, 4], [0, 4, 5, 1]],
    bass: { kind: "fifths", gain: 0.1 }, arp: { instrument: "harp", pattern: [0, 1, 2, 3, 4, 3, 2, 1], per: 2, octave: 24, gain: 0.06 },
    pad: { gain: 0.016, octave: 12 }, melody: { instrument: "flute", octave: 36, gain: 0.065, rests: 0.2 }, bells: { gain: 0.02, chance: 0.06 },
  },
};

/** A note of the song: a MIDI note, when (beats into the section) and for how long (beats). */
interface Note { midi: number; t: number; len: number }

/** Each bar's rhythms for a tune, in beats (four to a bar). */
const RHYTHMS = [[1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [1.5, 0.5, 2], [0.5, 0.5, 1, 2], [3, 1], [2, 2], [1, 0.5, 0.5, 2], [1, 1, 1.5, 0.5]];

/**
 * A song in a style, from a seed: it makes its bars as the engine asks for them (`bars`), each part's
 * notes at their sample times. Sections of four chords; the tune's motif is made for its first and
 * comes back in later ones a little changed (A A' B A), a new motif every four sections; the tune
 * rests in the first section, so the band comes in first.
 */
export class Song {
  readonly mood: Mood;
  readonly group: string;
  private readonly style: Style;
  private readonly rate: number;
  private readonly r: () => number;
  /** The next bar to make, and when it starts (samples). */
  private bar = 0;
  private next: number;
  private progression: number[] = [];
  /** The A sections' progression (the B section has its own). */
  private home: number[] = [];
  private tune: Note[] = [];
  private motif: Note[] = [];

  constructor(mood: Mood, seed: number, start: number, rate: number, group: string) {
    this.mood = mood;
    this.style = STYLES[mood];
    this.rate = rate;
    this.r = rng(seed);
    this.next = start;
    this.group = group;
  }

  private get beat(): number { return (60 / this.style.bpm) * this.rate; }
  private get sectionBars(): number { return 4 * this.style.hold; }

  /** The bars that start before `until` (samples), as parts with their times. */
  bars(until: number): Array<{ at: number; spec: PartSpec }> {
    const out: Array<{ at: number; spec: PartSpec }> = [];
    while (this.next < until) {
      for (const n of this.makeBar()) out.push({ at: this.next + n.t * this.beat, spec: n.spec });
      this.next += this.style.beats * this.beat;
      this.bar++;
    }
    return out;
  }

  /** One bar's parts, at beats into it. */
  private makeBar(): Array<{ t: number; spec: PartSpec }> {
    const s = this.style, r = this.r;
    const within = this.bar % this.sectionBars;
    const section = Math.floor(this.bar / this.sectionBars);
    if (within === 0) this.newSection(section);
    const degree = this.progression[Math.floor(within / s.hold)] ?? 0;
    const chord = this.chord(degree);
    const out: Array<{ t: number; spec: PartSpec }> = [];
    const at = (t: number, spec: PartSpec) => out.push({ t: this.lilt(t), spec });

    if (s.bass) this.bassOf(s.bass, chord, at);
    if (s.strum) this.strumOf(s.strum.gain, chord, at);
    if (s.arp) {
      const notes = [...chord, chord[0]! + 12, chord[1]! + 12].map(n => n + s.arp!.octave);
      const count = s.beats * s.arp.per;
      for (let i = 0; i < count; i++) {
        const n = notes[s.arp.pattern[i % s.arp.pattern.length]! % notes.length]!;
        at(i / s.arp.per + (r() - 0.5) * 0.02, instrument(s.arp.instrument, n, 1 / s.arp.per, s.arp.gain * (i % s.arp.per === 0 ? 1 : 0.8) * (0.9 + r() * 0.2), (r() - 0.5) * 0.5, this.beatMs));
      }
    }
    if (s.pad && within % s.hold === 0) for (const n of chord) at(0, pad(n + s.pad.octave, s.hold * s.beats * this.beatMs, s.pad.gain));
    if (s.drone && within === 0) for (const n of [this.low(chord[0]!), this.low(chord[0]!) + 7]) at(0, drone(n, this.sectionBars * s.beats * this.beatMs, s.drone.gain));
    if (s.bells) for (let b = 0; b < s.beats; b++) if (r() < s.bells.chance) at(b + (r() < 0.5 ? 0.5 : 0), instrument("bell", chord[Math.floor(r() * 3)]! + 36, 2, s.bells.gain, (r() - 0.5) * 0.8, this.beatMs));
    if (s.drums) this.drumsOf(s.drums.gain, within, at);
    if (s.melody) {
      for (const n of this.tune) {
        const bar = Math.floor(n.t / s.beats);
        if (bar !== within) continue;
        at(n.t - bar * s.beats, instrument(s.melody.instrument, n.midi, n.len, s.melody.gain, 0.1, this.beatMs));
      }
    }
    return out;
  }

  private get beatMs(): number { return 60000 / this.style.bpm; }

  /** Offbeat eighths a little late, for a swing. */
  private lilt(t: number): number {
    const swing = this.style.swing ?? 0.5;
    const whole = Math.floor(t), part = t - whole;
    return Math.abs(part - 0.5) < 0.01 ? whole + swing : t;
  }

  /**
   * A section begins: its progression (the A sections' own, kept from the first of four; the B
   * section, the third, another), and its tune (the motif made, kept, changed or rested).
   */
  private newSection(section: number): void {
    const s = this.style, r = this.r;
    const form = section % 4;
    const pick = () => s.progressions[Math.floor(r() * s.progressions.length)]!;
    if (form === 0) this.home = pick();
    const other = s.progressions.filter(p => p !== this.home);
    this.progression = form === 2 && other.length ? other[Math.floor(r() * other.length)]! : this.home;
    if (!s.melody) return;
    if (form === 0) this.motif = this.makeTune();
    if (section === 0 || r() < s.melody.rests) { this.tune = []; return; }
    this.tune = form === 2 ? this.makeTune() : form === 1 ? this.vary(this.motif) : this.motif;
  }

  /** A tune for the section: each bar a rhythm, its notes walking the scale, a chord's note on each downbeat, home on the last. */
  private makeTune(): Note[] {
    const s = this.style, r = this.r;
    const notes: Note[] = [];
    let step = [0, 2, 4][Math.floor(r() * 3)]!;
    for (let bar = 0; bar < this.sectionBars; bar++) {
      const degree = this.progression[Math.floor(bar / s.hold)] ?? 0;
      const rhythm = bar === this.sectionBars - 1 ? [2, 2] : RHYTHMS[Math.floor(r() * RHYTHMS.length)]!;
      let t = bar * s.beats;
      rhythm.forEach((len, i) => {
        if (i === 0) step = nearestChordStep(step, degree);
        else step += [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)]!;
        step = Math.max(-2, Math.min(9, step));
        if (bar === this.sectionBars - 1 && i === rhythm.length - 1) step = nearestChordStep(step, 0);
        // A short rest now and then, so the tune breathes.
        if (!(i > 0 && r() < 0.12)) notes.push({ midi: this.stepMidi(step) + s.melody!.octave, t, len: len * 0.95 });
        t += len;
      });
    }
    return notes;
  }

  /** The motif again, its second half moved a step or two and its end made to land. */
  private vary(motif: Note[]): Note[] {
    const half = (this.sectionBars * this.style.beats) / 2;
    const shift = [1, -1, 2][Math.floor(this.r() * 3)]!;
    return motif.map(n => (n.t < half ? n : { ...n, midi: this.shiftInScale(n.midi, shift) }));
  }

  /** A note moved `steps` along the scale. */
  private shiftInScale(midi: number, steps: number): number {
    const s = this.style;
    const rel = midi - s.root;
    const octave = Math.floor(rel / 12), pc = ((rel % 12) + 12) % 12;
    const at = s.mode.indexOf(pc);
    if (at < 0) return midi;
    return this.stepMidi(octave * 7 + at + steps);
  }

  /** A step of the scale (0 the tonic, 7 an octave up) as a MIDI note above the root. */
  private stepMidi(step: number): number {
    const mode = this.style.mode;
    const octave = Math.floor(step / 7), at = ((step % 7) + 7) % 7;
    return this.style.root + 12 * octave + mode[at]!;
  }

  /** A note folded down into the bass's range: from a fifth under the root to a fifth over it. */
  private low(midi: number): number {
    let m = midi;
    while (m > this.style.root + 6) m -= 12;
    while (m < this.style.root - 6) m += 12;
    return m;
  }

  /** The chord on a degree of the scale: its root, third and fifth, as MIDI notes from the root's octave. */
  private chord(degree: number): number[] {
    return [degree, degree + 2, degree + 4].map(step => this.stepMidi(step));
  }

  private bassOf(bass: NonNullable<Style["bass"]>, chord: number[], at: (t: number, spec: PartSpec) => void): void {
    const s = this.style, beat = this.beatMs;
    const root = this.low(chord[0]!), fifth = this.low(chord[2]!);
    const play = (t: number, midi: number, beats: number, gain: number) => at(t, bassNote(midi, beats * beat * 0.9, gain, bass.wave ?? "triangle"));
    if (bass.kind === "root") play(0, root, s.beats, bass.gain);
    else if (bass.kind === "fifths") { play(0, root, 2, bass.gain); play(2, fifth, 2, bass.gain * 0.85); }
    else for (let i = 0; i < s.beats * 2; i++) play(i / 2, i % 4 === 3 ? root + 12 : root, 0.45, bass.gain * (i % 2 ? 0.75 : 1));
  }

  private strumOf(gain: number, chord: number[], at: (t: number, spec: PartSpec) => void): void {
    const r = this.r;
    at(0, instrument("lute", this.low(chord[0]!), 1, gain * 1.3, -0.2, this.beatMs));
    at(2, instrument("lute", this.low(chord[2]!), 1, gain * 1.2, -0.2, this.beatMs));
    for (const beat of [1, 3, 3.5]) {
      if (beat === 3.5 && r() < 0.5) continue;
      chord.forEach((n, i) => at(beat + i * 0.03, instrument("lute", n + 12, 0.5, gain * (beat === 3.5 ? 0.6 : 0.8), 0.25, this.beatMs)));
    }
  }

  private drumsOf(gain: number, within: number, at: (t: number, spec: PartSpec) => void): void {
    const s = this.style, r = this.r;
    const fill = within % 4 === 3;
    for (let i = 0; i < s.beats * 2; i++) {
      const t = i / 2;
      if (t === 0 || t === 2 || (t === 2.5 && r() < 0.4)) at(t, kick(0.26 * gain));
      if (t === 1 || t === 3) at(t, snare(0.1 * gain));
      if (!(fill && t >= 3)) at(t, hat(0.025 * gain * (i % 2 ? 0.7 : 1)));
    }
    if (fill) for (const t of [3, 3.25, 3.5, 3.75]) at(t, snare(0.06 * gain * (0.7 + (t - 3))));
  }
}

/** The chord tone of `degree` nearest a scale step: its root, third or fifth. */
function nearestChordStep(step: number, degree: number): number {
  let best = step, far = Infinity;
  for (let octave = -1; octave <= 2; octave++) for (const k of [0, 2, 4]) {
    const c = degree + k + octave * 7;
    if (Math.abs(c - step) < far) { far = Math.abs(c - step); best = c; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// The band.

/** A note on an instrument: `beats` long at `beatMs` a beat, panned a little. */
function instrument(kind: Instrument, midi: number, beats: number, gain: number, pan: number, beatMs: number): PartSpec {
  const f = hz(midi), ms = beats * beatMs;
  switch (kind) {
    case "harp": return { kind: "pluck", freq: f, decay: 2.2, bright: 0.55, gain, pan, bus: "music", room: 0.35, env: {} };
    case "lute": return { kind: "pluck", freq: f, decay: 1.1, bright: 0.3, gain, pan, bus: "music", room: 0.25, env: {} };
    case "flute": return { kind: "tone", wave: "triangle", freq: f, gain, pan, bus: "music", room: 0.4, lp: f * 3, env: { a: 45, s: 0.85, hold: Math.max(60, ms * 0.92), r: 120 }, vib: { rate: 5, depth: 0.18, after: 180 } };
    case "chip": return { kind: "tone", wave: "pulse", duty: 0.25, freq: f, gain, pan, bus: "music", room: 0.2, lp: 3000, env: { a: 4, d: 180, s: 0.55, hold: Math.max(50, ms * 0.85), r: 60 }, vib: { rate: 6, depth: 0.12, after: 220 } };
    case "bell": return { kind: "tone", wave: "sine", freq: f, gain, pan, bus: "music", room: 0.5, env: { a: 2, d: 1400 }, fm: { ratio: 3.5, index: 1.6, fall: 500 } };
  }
}

function bassNote(midi: number, ms: number, gain: number, wave: "triangle" | "pulse"): PartSpec {
  return { kind: "tone", wave, duty: 0.25, freq: hz(midi), gain, bus: "music", lp: wave === "pulse" ? 700 : 900, env: { a: 6, s: 0.8, d: 200, hold: Math.max(40, ms), r: 90 } };
}

function pad(midi: number, ms: number, gain: number): PartSpec {
  return { kind: "tone", wave: "triangle", freq: hz(midi), gain, bus: "music", room: 0.5, detune: 7, lp: 1400, env: { a: 500, s: 1, hold: Math.max(200, ms - 200), r: 700 } };
}

function drone(midi: number, ms: number, gain: number): PartSpec {
  return { kind: "tone", wave: "triangle", freq: hz(midi), gain, bus: "music", room: 0.4, detune: 4, lp: 600, env: { a: 1500, s: 1, hold: Math.max(400, ms - 400), r: 2000 } };
}

function kick(gain: number): PartSpec {
  return { kind: "tone", wave: "sine", freq: 150, to: 45, glide: 100, gain, bus: "music", env: { a: 1, d: 180 } };
}

function snare(gain: number): PartSpec {
  return { kind: "noise", filter: "bp", freq: 1800, q: 0.8, gain, bus: "music", room: 0.2, env: { a: 1, d: 130 } };
}

function hat(gain: number): PartSpec {
  return { kind: "noise", filter: "hp", freq: 7000, gain, bus: "music", env: { a: 1, d: 30 } };
}
