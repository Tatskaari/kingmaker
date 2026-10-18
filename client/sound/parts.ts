// New: what a sound is made of (docs/sound-design.md): a tone, a band of noise or a plucked string, each with its envelope, its gain and where it sits (its bus, its side, how much of it reaches the room); and each of them playing, a block at a time, for the engine (engine.ts) to mix.
import { EnvPlay, Filter, PluckPlay, TAU, waveAt, type Env, type Wave } from "./dsp.ts";

/** Where a part is mixed, each with its own volume: the effects (the menus' too), the voices, the music. */
export type Bus = "sfx" | "voice" | "music";

interface Common {
  /** When it starts: ms after the sound's own start. */
  at?: number;
  env: Env;
  gain: number;
  /** Left (-1) to right (1). */
  pan?: number;
  /** The effects' unless it says. */
  bus?: Bus;
  /** How much of it reaches the room (0 to 1): the ring after it. */
  room?: number;
}

/** A tone: a wave at a pitch, which can glide, wobble, shimmer or ring like a bell, through a filter. */
export interface ToneSpec extends Common {
  kind: "tone";
  wave: Wave;
  freq: number;
  /** Where the pitch glides to, over `glide` ms (the attack and decay unless it says). */
  to?: number;
  glide?: number;
  /** A pulse's width (an eighth is the thin chip voice). */
  duty?: number;
  /** Vibrato: how fast (Hz), how deep (semitones), and after how long (ms). */
  vib?: { rate: number; depth: number; after?: number };
  /** A second voice this many cents above (the first as many below): a chorus's width. */
  detune?: number;
  /** A bell: a sine `ratio` times the pitch bends it by `index`, falling away over `fall` ms. */
  fm?: { ratio: number; index: number; fall?: number };
  /** A low-pass's cutoff (Hz), swept to `lpTo` over `sweep` ms; a high-pass under it. */
  lp?: number;
  lpTo?: number;
  sweep?: number;
  q?: number;
  hp?: number;
}

/** A band of noise: below, around or above `freq`, which can sweep; steady hiss, a held grain, or crackle. */
export interface NoiseSpec extends Common {
  kind: "noise";
  filter: "lp" | "bp" | "hp";
  freq: number;
  to?: number;
  sweep?: number;
  q?: number;
  /** Held this many times a second (Hz): the grainy noise of old consoles' blasts and drums. */
  grain?: number;
  /** Clicks, about this many a second, in place of a steady hiss: fire, embers, dice. */
  crackle?: number;
}

/** A plucked string: a lute's or a harp's note, `decay` seconds to fall away (60 dB), `bright` (0 to 1) its edge. */
export interface PluckSpec extends Common {
  kind: "pluck";
  freq: number;
  decay: number;
  bright?: number;
}

export type PartSpec = ToneSpec | NoiseSpec | PluckSpec;

/** How often a moving filter is set again (samples): a sweep's steps are too small to hear. */
const RESET = 16;

/**
 * A part playing: `render` writes its next samples (mono, before its gain's pan) and says whether
 * there are more. A hush fades it out over a few ms rather than cutting it, so nothing clicks.
 */
export abstract class Playing {
  readonly bus: Bus;
  readonly left: number;
  readonly right: number;
  readonly room: number;
  readonly group: string | undefined;
  done = false;
  protected readonly env: EnvPlay;
  protected readonly gain: number;
  protected readonly rate: number;
  private fading = 0;
  private fadeFor = 0;

  constructor(spec: PartSpec, rate: number, group: string | undefined) {
    this.rate = rate;
    this.bus = spec.bus ?? "sfx";
    // Constant power across: a part in the middle is as loud as one at a side.
    const pan = Math.max(-1, Math.min(1, spec.pan ?? 0));
    this.left = Math.cos(((pan + 1) * Math.PI) / 4);
    this.right = Math.sin(((pan + 1) * Math.PI) / 4);
    this.room = spec.room ?? 0;
    this.group = group;
    this.env = new EnvPlay(spec.env, rate);
    this.gain = spec.gain;
  }

  /** Away over `ms`, quietly. */
  fade(ms: number): void {
    const n = Math.max(1, Math.round((ms * this.rate) / 1000));
    if (this.fading && this.fading <= n) return;
    this.fading = n;
    this.fadeFor = n;
  }

  /** Its samples from `from` to `to` (exclusive) into `out`; false once it has nothing more to play. */
  render(out: Float32Array, from: number, to: number): boolean {
    for (let i = from; i < to; i++) {
      if (this.done) { out[i] = 0; continue; }
      let v = this.sample() * this.env.next() * this.gain;
      if (this.fading) {
        v *= this.fading / this.fadeFor;
        if (--this.fading === 0) this.done = true;
      }
      if (this.env.done) this.done = true;
      out[i] = v;
    }
    return !this.done;
  }

  protected abstract sample(): number;
}

/** A tone playing. */
class TonePlaying extends Playing {
  private readonly spec: ToneSpec;
  private phase = 0;
  private phase2 = 0;
  private modPhase = 0;
  private freq: number;
  private readonly glideStep: number;
  private glideLeft: number;
  private readonly lpStep: number;
  private cutoff: number;
  private sweepLeft: number;
  private readonly low: Filter | undefined;
  private readonly high: Filter | undefined;
  private readonly fmFall: number;
  private fmIndex: number;
  private n = 0;
  private readonly spread: number;

  constructor(spec: ToneSpec, rate: number, group: string | undefined) {
    super(spec, rate, group);
    this.spec = spec;
    this.freq = spec.freq;
    const ms = rate / 1000;
    const glideFor = Math.max(1, (spec.glide ?? (spec.env.a ?? 2) + (spec.env.d ?? 120)) * ms);
    this.glideLeft = spec.to ? glideFor : 0;
    this.glideStep = spec.to ? (spec.to / spec.freq) ** (1 / glideFor) : 1;
    this.cutoff = spec.lp ?? 0;
    const sweepFor = Math.max(1, (spec.sweep ?? glideFor / ms) * ms);
    this.sweepLeft = spec.lp && spec.lpTo ? sweepFor : 0;
    this.lpStep = spec.lp && spec.lpTo ? (spec.lpTo / spec.lp) ** (1 / sweepFor) : 1;
    if (spec.lp) { this.low = new Filter(); this.low.set(spec.lp, spec.q ?? 0.7, rate); }
    if (spec.hp) { this.high = new Filter(); this.high.set(spec.hp, 0.7, rate); }
    this.fmIndex = spec.fm?.index ?? 0;
    this.fmFall = spec.fm ? Math.exp(-4.6 / Math.max(1, (spec.fm.fall ?? 400) * ms)) : 1;
    this.spread = spec.detune ? 2 ** (spec.detune / 1200) : 1;
  }

  protected sample(): number {
    const s = this.spec, rate = this.rate;
    const n = this.n++;
    if (this.glideLeft > 0) { this.freq *= this.glideStep; this.glideLeft--; }
    let f = this.freq;
    if (s.vib) {
      const after = ((s.vib.after ?? 0) * rate) / 1000;
      if (n > after) {
        const ramp = Math.min(1, (n - after) / (0.15 * rate));
        f *= 2 ** ((s.vib.depth * ramp * Math.sin((TAU * s.vib.rate * n) / rate)) / 12);
      }
    }
    let v: number;
    if (s.fm) {
      this.modPhase = (this.modPhase + (f * s.fm.ratio) / rate) % 1;
      this.phase = (this.phase + f / rate) % 1;
      v = Math.sin(TAU * this.phase + this.fmIndex * Math.sin(TAU * this.modPhase));
      this.fmIndex *= this.fmFall;
    } else if (s.detune) {
      const fa = f / this.spread, fb = f * this.spread;
      v = 0.5 * (waveAt(s.wave, this.phase, fa / rate, s.duty) + waveAt(s.wave, this.phase2, fb / rate, s.duty));
      this.phase = (this.phase + fa / rate) % 1;
      this.phase2 = (this.phase2 + fb / rate) % 1;
    } else {
      v = waveAt(s.wave, this.phase, f / rate, s.duty);
      this.phase = (this.phase + f / rate) % 1;
    }
    if (this.low) {
      if (this.sweepLeft > 0) {
        this.cutoff *= this.lpStep;
        this.sweepLeft--;
        if (n % RESET === 0) this.low.set(this.cutoff, s.q ?? 0.7, rate);
      }
      this.low.run(v);
      v = this.low.lp;
    }
    if (this.high) { this.high.run(v); v = this.high.hp; }
    return v;
  }
}

/** A band of noise playing. */
class NoisePlaying extends Playing {
  private readonly spec: NoiseSpec;
  private readonly filter = new Filter();
  private readonly random: () => number;
  private freq: number;
  private readonly step: number;
  private sweepLeft: number;
  private held = 0;
  private grainPhase = 1;
  private click = 0;
  private readonly clickFall: number;
  private n = 0;

  constructor(spec: NoiseSpec, rate: number, group: string | undefined, random: () => number) {
    super(spec, rate, group);
    this.spec = spec;
    this.random = random;
    this.freq = spec.freq;
    const ms = rate / 1000;
    const sweepFor = Math.max(1, (spec.sweep ?? (spec.env.a ?? 2) + (spec.env.d ?? 120)) * ms);
    this.sweepLeft = spec.to ? sweepFor : 0;
    this.step = spec.to ? (spec.to / spec.freq) ** (1 / sweepFor) : 1;
    this.filter.set(spec.freq, spec.q ?? 0.7, rate);
    this.clickFall = Math.exp(-1 / (0.0012 * rate));
  }

  protected sample(): number {
    const s = this.spec;
    const n = this.n++;
    let v: number;
    if (s.crackle) {
      if (this.random() < s.crackle / this.rate) this.click = (this.random() < 0.5 ? -1 : 1) * (0.4 + 0.6 * this.random());
      v = this.click * (this.random() * 0.6 + 0.4);
      this.click *= this.clickFall;
    } else if (s.grain) {
      this.grainPhase += s.grain / this.rate;
      if (this.grainPhase >= 1) { this.grainPhase -= 1; this.held = this.random() * 2 - 1; }
      v = this.held;
    } else {
      v = this.random() * 2 - 1;
    }
    if (this.sweepLeft > 0) {
      this.freq *= this.step;
      this.sweepLeft--;
      if (n % RESET === 0) this.filter.set(this.freq, s.q ?? 0.7, this.rate);
    }
    this.filter.run(v);
    return s.filter === "lp" ? this.filter.lp : s.filter === "bp" ? this.filter.bp : this.filter.hp;
  }
}

/** A plucked string playing: its envelope only holds it and lets it go, as the string dies away by itself. */
class PluckPlaying extends Playing {
  private readonly string: PluckPlay;

  constructor(spec: PluckSpec, rate: number, group: string | undefined, random: () => number) {
    super({ ...spec, env: { a: 1, s: 1, hold: spec.decay * 1000, r: 60, ...spec.env } }, rate, group);
    this.string = new PluckPlay(spec.freq, spec.decay, spec.bright ?? 0.5, rate, random);
  }

  protected sample(): number {
    return this.string.next();
  }
}

/** A part's spec, playing from now. */
export function play(spec: PartSpec, rate: number, group: string | undefined, random: () => number): Playing {
  switch (spec.kind) {
    case "tone": return new TonePlaying(spec, rate, group);
    case "noise": return new NoisePlaying(spec, rate, group, random);
    case "pluck": return new PluckPlaying(spec, rate, group, random);
  }
}
