// New: the sound engine's building blocks (docs/sound-design.md): waves, noise, a filter, an envelope, a plucked string and a small room, each a sample at a time and none allocating as it plays. Everything the game hears is made from these, so nothing is a recording: the engine (engine.ts) plays them on a page's audio thread or beside a terminal.

export const TAU = Math.PI * 2;

/** A note's frequency: a MIDI note number in Hz (69 is A4, 440 Hz; 60 is middle C). */
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** A frequency moved by `n` semitones. */
export const semis = (f: number, n: number): number => f * 2 ** (n / 12);

/** A seeded random in [0, 1) (mulberry32): the same seed makes the same sound. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A word's number (FNV-1a), for a seed: a speaker's key, a cue's name. */
export function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export type Wave = "sine" | "triangle" | "square" | "pulse" | "saw";

/** PolyBLEP: the step a square or a saw takes at `t` (its phase), rounded off over a sample, so its edges don't alias into a whine. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * One sample of a wave at `phase` (0 to 1), `dt` the phase it moves a sample (its frequency over the
 * rate). A pulse's `duty` is how much of each cycle it's high (a square's is a half; an eighth is the
 * thin, nasal chip voice), centred so it has no DC.
 */
export function waveAt(wave: Wave, phase: number, dt: number, duty = 0.5): number {
  switch (wave) {
    case "sine": return Math.sin(TAU * phase);
    case "triangle": return 4 * Math.abs(phase - 0.5) - 1;
    case "saw": return 2 * phase - 1 - blep(phase, dt);
    case "square": case "pulse": {
      const d = wave === "square" ? 0.5 : duty;
      let v = phase < d ? 1 : -1;
      v += blep(phase, dt);
      v -= blep((phase - d + 1) % 1, dt);
      return v - (2 * d - 1);
    }
  }
}

/**
 * A state-variable filter (the topology-preserving one, Andrew Simper's), stable however fast its
 * cutoff moves: low-pass, band-pass and high-pass at once. `q` near 0.7 is plain; higher rings.
 */
export class Filter {
  lp = 0;
  bp = 0;
  hp = 0;
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 1;
  private a2 = 0;
  private a3 = 0;
  private k = 1.4;

  set(cutoff: number, q: number, rate: number): void {
    const g = Math.tan((Math.PI * Math.min(Math.max(cutoff, 10), rate * 0.45)) / rate);
    this.k = 1 / Math.max(0.1, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  run(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
  }
}

/**
 * An envelope, in ms: up over `a` (attack), down towards `s` (sustain, 0 to 1) over about `d` (decay:
 * within a hundredth of it by then), held until `hold`, then gone over about `r` (release). With no
 * sustain it's a strike: up, then away, and over once it's quiet.
 */
export interface Env { a?: number; d?: number; s?: number; hold?: number; r?: number }

/** An envelope playing, a sample at a time. */
export class EnvPlay {
  level = 0;
  done = false;
  private n = 0;
  private readonly attack: number;
  private readonly decayK: number;
  private readonly sustain: number;
  private readonly hold: number;
  private readonly releaseK: number;

  constructor(env: Env, rate: number) {
    const ms = rate / 1000;
    this.attack = Math.max(1, (env.a ?? 2) * ms);
    this.decayK = Math.exp(-4.6 / Math.max(1, (env.d ?? 120) * ms));
    this.sustain = env.s ?? 0;
    this.hold = env.hold !== undefined ? Math.max(this.attack, env.hold * ms) : Infinity;
    this.releaseK = Math.exp(-4.6 / Math.max(1, (env.r ?? 60) * ms));
  }

  next(): number {
    const n = this.n++;
    if (n < this.attack && n < this.hold) {
      this.level = (n + 1) / this.attack;
    } else if (n < this.hold) {
      this.level = this.sustain + (this.level - this.sustain) * this.decayK;
      if (this.sustain === 0 && this.level < 0.0004) this.done = true;
    } else {
      this.level *= this.releaseK;
      if (this.level < 0.0004) this.done = true;
    }
    return this.level;
  }
}

/**
 * A plucked string (Karplus-Strong): a burst of noise going round a delay line a period long, softened
 * a little each time round, so it rings at the period's pitch and dies away like a lute's or a harp's
 * string. `decay` is how long it takes to fall 60 dB (seconds); `bright` (0 to 1) how much of the
 * pluck's edge stays.
 */
export class PluckPlay {
  private readonly line: Float32Array;
  private readonly period: number;
  private readonly loss: number;
  private readonly smooth: number;
  private write = 0;
  private last = 0;

  constructor(freq: number, decay: number, bright: number, rate: number, random: () => number) {
    // The loop's softening: the classic average (0.5) for a dull string, less for a bright one. It
    // delays what goes round by its own weight, so the line is that much shorter, and in tune.
    this.smooth = 0.5 - 0.42 * Math.min(1, Math.max(0, bright));
    this.period = Math.max(2, rate / Math.max(20, freq) - this.smooth);
    this.line = new Float32Array(Math.ceil(this.period) + 2);
    this.loss = 10 ** (-3 / (Math.max(0.05, decay) * Math.max(20, freq)));
    // The pluck: noise, softened for a dull string, without DC.
    let lp = 0, sum = 0;
    const soft = 0.15 + 0.8 * (1 - bright);
    for (let i = 0; i < this.line.length; i++) {
      lp += (random() * 2 - 1 - lp) * (1 - soft * 0.9);
      this.line[i] = lp;
      sum += lp;
    }
    const mean = sum / this.line.length;
    for (let i = 0; i < this.line.length; i++) this.line[i]! -= mean;
  }

  next(): number {
    const size = this.line.length;
    // Read a period back (between two samples: the linear blend tunes it between whole samples).
    let at = this.write - this.period;
    while (at < 0) at += size;
    const i = Math.floor(at), f = at - i;
    const a = this.line[i % size]!, b = this.line[(i + 1) % size]!;
    const out = a + (b - a) * f;
    const fed = this.loss * ((1 - this.smooth) * out + this.smooth * this.last);
    this.last = out;
    this.line[this.write] = fed;
    this.write = (this.write + 1) % size;
    return out;
  }
}

/** A delay line that feeds back through a soft low-pass: a reverb's comb (Freeverb's). */
class Comb {
  private readonly line: Float32Array;
  private at = 0;
  private store = 0;
  constructor(length: number) { this.line = new Float32Array(Math.max(1, length)); }
  run(x: number, feedback: number, damp: number): number {
    const y = this.line[this.at]!;
    this.store = y * (1 - damp) + this.store * damp;
    this.line[this.at] = x + this.store * feedback;
    if (++this.at >= this.line.length) this.at = 0;
    return y;
  }
}

/** A delay line that passes every frequency but smears them in time: a reverb's diffuser. */
class Allpass {
  private readonly line: Float32Array;
  private at = 0;
  constructor(length: number) { this.line = new Float32Array(Math.max(1, length)); }
  run(x: number): number {
    const y = this.line[this.at]!;
    this.line[this.at] = x + y * 0.5;
    if (++this.at >= this.line.length) this.at = 0;
    return y - x;
  }
}

/**
 * A small room (Freeverb, cut down to four combs and two diffusers a side): what the music and the
 * spells are heard in, so a pluck or a boom has somewhere to ring. Mono in, stereo out, the right a
 * few samples longer than the left.
 */
export class Room {
  size = 0.8;
  damp = 0.3;
  private readonly left: { combs: Comb[]; passes: Allpass[] };
  private readonly right: { combs: Comb[]; passes: Allpass[] };

  constructor(rate: number) {
    const scale = rate / 44100;
    const side = (spread: number) => ({
      combs: [1116, 1277, 1422, 1617].map(n => new Comb(Math.round((n + spread) * scale))),
      passes: [556, 341].map(n => new Allpass(Math.round((n + spread) * scale))),
    });
    this.left = side(0);
    this.right = side(23);
  }

  /** One sample in; the room's left and right out (into `out`). */
  run(x: number, out: { l: number; r: number }): void {
    const input = x * 0.12;
    let l = 0, r = 0;
    for (const c of this.left.combs) l += c.run(input, this.size, this.damp);
    for (const c of this.right.combs) r += c.run(input, this.size, this.damp);
    for (const p of this.left.passes) l = p.run(l);
    for (const p of this.right.passes) r = p.run(r);
    out.l = l;
    out.r = r;
  }
}

/**
 * A limiter over the mix: nothing goes out above `ceiling`. It looks a moment ahead (the mix comes
 * out `ahead` ms late), so its gain is down before a peak reaches the output, holds it there while
 * the peak passes, and lets it back up over about `release` ms: a pile of loud sounds (a fireball on
 * the music) comes out quieter, not clipped.
 */
export class Limiter {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private at = 0;
  private gain = 1;
  private target = 1;
  private held = 0;
  private readonly attack: number;
  private readonly release: number;
  private readonly ceiling: number;

  constructor(rate: number, ceiling = 0.84, ahead = 2, release = 150) {
    this.ceiling = ceiling;
    const size = Math.max(1, Math.round((ahead * rate) / 1000));
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
    this.attack = 1 - Math.exp(-5 / size);
    this.release = 1 - Math.exp(-1 / ((release * rate) / 1000));
  }

  /** One stereo sample in; the limited one out (`ahead` ms behind it). */
  run(l: number, r: number, out: { l: number; r: number }): void {
    const peak = Math.max(Math.abs(l), Math.abs(r));
    const need = peak > this.ceiling ? this.ceiling / peak : 1;
    if (need <= this.target) { this.target = need; this.held = this.left.length; }
    else if (this.held > 0) this.held--;
    else this.target = need;
    this.gain += (this.target - this.gain) * (this.target < this.gain ? this.attack : this.release);
    const dl = this.left[this.at]!, dr = this.right[this.at]!;
    this.left[this.at] = l;
    this.right[this.at] = r;
    this.at = (this.at + 1) % this.left.length;
    out.l = dl * this.gain;
    out.r = dr * this.gain;
  }
}

/** A last soft limit at full scale, past the limiter: anything that gets by it rounds off rather than clipping. */
export function soften(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  const over = (a - 0.9) / 0.1;
  return Math.sign(x) * (0.9 + 0.1 * Math.tanh(over));
}
