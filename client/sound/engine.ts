// New: the sound engine (docs/sound-design.md): told what to play (sound effects, voices' blips, the music's mood, a hush, the volumes) and asked for its next block of samples, it makes them all from parts (parts.ts), each started on the sample it was asked for, mixed through its bus's volume and the room, brought up to the level a game is heard at, and limited at the top. A page runs it on its audio thread (web/page/sound-worklet.ts); the tests offline.
import { hashOf, Limiter, rng, Room, soften } from "./dsp.ts";
import { Song, type Mood } from "./music.ts";
import { play, type Bus, type PartSpec, type Playing } from "./parts.ts";
import { blipOf, patchOf, type Cue, type Voice } from "./patches.ts";
import { MOST_MASTER, VOLUMES, type Volumes } from "./volumes.ts";

import { TuneSong, validateTune, noteParts, type Tune } from "./tune.ts";

import { EMPTY_LIBRARY, cueReference, type SoundLibrary } from "./library.ts";
import type { MusicAssignments, MusicSlot } from "../../shared/music/assignments.ts";

export type { Volumes };

/**
 * What the engine is told. `delay` (ms) starts a sound that much later, on the sample; `group` names
 * the sounds a hush can stop (a talk's blips, a fight's moment): what's playing of it fades, what's
 * still to come never comes.
 */
export type SoundMessage =
  | { type: "sfx"; cue: Cue; delay?: number; group?: string }
  | { type: "blip"; voice: Voice; letter: string; delay?: number; group?: string }
  | { type: "music"; mood: Mood | null; tune?: Tune; track?: string; scene?: string; map?: string; slot?: string }
  | { type: "tune-update"; tune: Tune }
  | { type: "hush"; group: string }
  | { type: "volume"; volumes: Partial<Volumes> };

/**
 * The mix's level: the parts' gains are a quiet mix's, which this brings up 12 dB to where a game is
 * heard (the music about -20 LUFS, a voice about -17), into the limiter, which keeps a fireball on
 * the music from clipping.
 */
const LEVEL = 4;

/** How far ahead the music is written (s): a bar is made once its start is this close. */
const AHEAD = 0.3;
/** How many parts may play at once: past it the oldest fade (a flood of cues mustn't stall the audio). */
const MOST = 160;
/** How many may wait to start. */
const MOST_WAITING = 4000;
/** How long the music takes to fade when the mood changes (ms), and the gap before the next song. */
const CHANGE_MS = 1400;
const GAP_S = 0.5;

interface Waiting { at: number; spec: PartSpec; group: string | undefined; songBeat?: number }

export class Engine {
  readonly rate: number;
  /** Samples played so far: the engine's clock. */
  time = 0;
  private waiting: Waiting[] = [];
  private playing: Array<{ part: Playing; from: number }> = [];
  private readonly room: Room;
  private readonly limiter: Limiter;
  private readonly limited = { l: 0, r: 0 };
  private readonly seed: number;
  private seq = 0;
  private song: Song | TuneSong | undefined;
  private songs = 0;
  private targets: Volumes = { ...VOLUMES };
  private readonly gains: Volumes = { ...VOLUMES };
  private readonly smoothing: number;
  private block = new Float32Array(0);
  private mix: Record<Bus, { l: Float32Array; r: Float32Array }> = { sfx: pair(0), voice: pair(0), music: pair(0) };
  private sends: Record<Bus, Float32Array> = { sfx: new Float32Array(0), voice: new Float32Array(0), music: new Float32Array(0) };
  private readonly wet = { l: 0, r: 0 };

  private readonly tunes: Partial<Record<Mood, Tune>>;
  private readonly library: SoundLibrary;
  private track: string | undefined;

  constructor(rate: number, seed = 1, tunes: Partial<Record<Mood, Tune>> = {}, library: SoundLibrary = EMPTY_LIBRARY) {
    this.library = library;
    this.tunes = tunes;
    this.rate = rate;
    this.seed = seed;
    this.room = new Room(rate);
    this.limiter = new Limiter(rate);
    // Volumes move over about 20 ms, so a change never clicks.
    this.smoothing = 1 - Math.exp(-1 / (0.02 * rate));
  }

  /** The mood the music is in (none when it's quiet). */
  get mood(): Mood | undefined { return this.song?.mood; }

  /** How many parts are playing, and waiting: for the tests and the sound board. */
  get load(): { playing: number; waiting: number } { return { playing: this.playing.length, waiting: this.waiting.length }; }

  receive(m: SoundMessage): void {
    switch (m.type) {
      case "sfx": this.schedule(this.cueParts(m.cue), this.when(m.delay), m.group); return;
      case "blip": this.schedule(blipOf(m.voice, m.letter, this.nextSeed()), this.when(m.delay), m.group); return;
      case "music": this.setMood(m); return;
      case "tune-update": this.updateTune(m.tune); return;
      case "hush": this.hush(m.group, 25); return;
      case "volume":
        this.targets = { ...this.targets, ...clean(m.volumes) };
        // Before its first block (the page's settings, as it starts) they're simply its volumes: nothing to move from.
        if (this.time === 0) Object.assign(this.gains, this.targets);
        return;
    }
  }

  /** The next block: `left` and `right` filled whole (they're the same array for a mono output). */
  render(left: Float32Array, right: Float32Array): void {
    const n = left.length;
    this.ready(n);
    if (this.song instanceof TuneSong) {
      for (const note of this.song.bars(this.time + n + AHEAD * this.rate)) this.wait(note.at, note.spec, this.song.group, note.beat);
    } else if (this.song) for (const note of this.song.bars(this.time + n + AHEAD * this.rate)) this.wait(note.at, note.spec, this.song.group);
    this.startDue(n);
    this.play(n);
    this.master(left, right, n);
    this.time += n;
  }

  // -------------------------------------------------------------------------------------------

  private nextSeed(): number { return hashOf(`${this.seed}:${++this.seq}`); }

  /** A delay (ms) as the sample it ends on. */
  private when(delay: number | undefined): number {
    return this.time + (Math.max(0, delay ?? 0) * this.rate) / 1000;
  }

  /** A sound's parts, each to start at `at` (samples) and its own offset. */
  private schedule(parts: PartSpec[], at: number, group: string | undefined): void {
    for (const spec of parts) this.wait(at + ((spec.at ?? 0) * this.rate) / 1000, spec, group);
  }

  /** A part waiting to start, in order of when. */
  private wait(at: number, spec: PartSpec, group: string | undefined, songBeat?: number): void {
    if (this.waiting.length >= MOST_WAITING) return;
    const list = this.waiting;
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.at <= at) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, { at, spec, group, songBeat });
  }

  /** What's due in this block starts, on its sample; a voice's blip cuts the one before it, as speech does. */
  private startDue(n: number): void {
    const end = this.time + n;
    let due = 0;
    while (due < this.waiting.length && this.waiting[due]!.at < end) due++;
    if (!due) return;
    for (const w of this.waiting.splice(0, due)) {
      const part = play(w.spec, this.rate, w.group, rng(this.nextSeed()));
      if (part.bus === "voice") for (const p of this.playing) if (p.part.bus === "voice") p.part.fade(6);
      this.playing.push({ part, from: Math.max(0, Math.min(n - 1, Math.round(w.at - this.time))) });
    }
    if (this.playing.length > MOST) for (const p of this.playing.slice(0, this.playing.length - MOST)) p.part.fade(5);
  }

  /** Every part's samples into its bus, and its share into the room. */
  private play(n: number): void {
    const block = this.block;
    const kept: Array<{ part: Playing; from: number }> = [];
    for (const p of this.playing) {
      const { part, from } = p;
      const more = part.render(block, from, n);
      const bus = this.mix[part.bus], send = this.sends[part.bus];
      const l = part.left, r = part.right, room = part.room;
      for (let i = from; i < n; i++) {
        const v = block[i]!;
        bus.l[i]! += v * l;
        bus.r[i]! += v * r;
        if (room) send[i]! += v * room;
      }
      if (more) kept.push({ part, from: 0 });
    }
    this.playing = kept;
  }

  /** The buses at their volumes, the room behind them, brought up to the game's level and limited. */
  private master(left: Float32Array, right: Float32Array, n: number): void {
    const g = this.gains, t = this.targets, k = this.smoothing, m = this.mix, s = this.sends;
    for (let i = 0; i < n; i++) {
      g.master += (t.master - g.master) * k;
      g.sfx += (t.sfx - g.sfx) * k;
      g.voice += (t.voice - g.voice) * k;
      g.music += (t.music - g.music) * k;
      const sfx = g.sfx * g.master, voice = g.voice * g.master, music = g.music * g.master;
      this.room.run(s.sfx[i]! * sfx + s.voice[i]! * voice + s.music[i]! * music, this.wet);
      const l = (m.sfx.l[i]! * sfx + m.voice.l[i]! * voice + m.music.l[i]! * music + this.wet.l) * LEVEL;
      const r = (m.sfx.r[i]! * sfx + m.voice.r[i]! * voice + m.music.r[i]! * music + this.wet.r) * LEVEL;
      this.limiter.run(l, r, this.limited);
      left[i] = soften(this.limited.l);
      if (right !== left) right[i] = soften(this.limited.r);
      else left[i] = soften((this.limited.l + this.limited.r) * 0.5);
    }
  }

  /** The block's buffers, as long as it is, emptied. */
  private ready(n: number): void {
    if (this.block.length < n) {
      this.block = new Float32Array(n);
      this.mix = { sfx: pair(n), voice: pair(n), music: pair(n) };
      this.sends = { sfx: new Float32Array(n), voice: new Float32Array(n), music: new Float32Array(n) };
      return;
    }
    for (const bus of [this.mix.sfx, this.mix.voice, this.mix.music]) { bus.l.fill(0, 0, n); bus.r.fill(0, 0, n); }
    this.sends.sfx.fill(0, 0, n);
    this.sends.voice.fill(0, 0, n);
    this.sends.music.fill(0, 0, n);
  }

  /** A group's sounds: what's playing fades over `ms`, what's waiting won't start. */
  private hush(group: string, ms: number): void {
    this.waiting = this.waiting.filter(w => w.group !== group);
    for (const p of this.playing) if (p.part.group === group) p.part.fade(ms);
  }

  /** The music changes mood: the song playing fades, and the new one starts after a breath; the same mood plays on. */
  private setMood(message: Extract<SoundMessage, {type: "music"}>): void {
    const { mood, tune } = message;
    if (tune) validateTune(tune);
    const slot = message.slot as MusicSlot | undefined;
    const choose = (assignments?: MusicAssignments) => slot ? assignments?.[slot] ?? (slot === 'next-morning' ? assignments?.morning : undefined) : undefined;
    const assigned = choose(message.scene ? this.library.scenes?.[message.scene] : undefined)
      ?? choose(message.map ? this.library.maps?.[message.map] : undefined);
    // A compiled map entry, including an empty one, supersedes stale campaign row assignments.
    const direct = message.map && Object.hasOwn(this.library.maps ?? {}, message.map) ? undefined : message.track;
    const track = assigned ?? direct ?? (mood ? this.library.music[mood] : undefined);
    if (!tune && (mood ?? undefined) === this.song?.mood && track === this.track) return;
    if (this.song) this.hush(this.song.group, CHANGE_MS);
    this.track = track;
    const score = tune ?? (track ? this.library.tunes[track] : undefined) ?? (mood ? this.tunes[mood] : undefined);
    if (mood && score) {
      this.song = new TuneSong(mood, score, this.time + GAP_S * this.rate, this.rate, `music:${++this.songs}`);
      return;
    }
    this.song = mood ? new Song(mood, this.nextSeed(), this.time + GAP_S * this.rate, this.rate, `music:${++this.songs}`) : undefined;
  }

  /** Live score edits replace lookahead; sounding voices and the song's clock continue. */
  private updateTune(tune: Tune): void {
    if (!(this.song instanceof TuneSong)) return;
    const group = this.song.group;
    const pending = this.waiting.flatMap(note => note.group === group && note.at >= this.time && note.songBeat !== undefined ? [note.songBeat] : []);
    const delayed = this.song.update(tune, this.time, pending);
    if (!delayed) return;
    this.waiting = this.waiting.filter(note => note.group !== group || note.at < this.time);
    for (const note of delayed) this.wait(note.at, note.spec, group, note.beat);
  }

  /** Cue sections use the effects bus, so menu sounds still respect the SFX switch. */
  private cueParts(cue: Cue): PartSpec[] {
    const ref = cueReference(this.library, cue), tune = ref && this.library.tunes[ref.tune];
    const section = tune?.sections.find(s => s.id === ref!.section);
    if (!ref || !tune || !section) return patchOf(cue, this.nextSeed());
    const beatMs = 60000 / tune.bpm;
    const durationScale = cue.ms && ref.source?.ms ? Math.max(0.1, Math.min(10, cue.ms / ref.source.ms)) : 1;
    const gainScale = cue.size && ref.source?.size ? Math.max(0.4, Math.min(2, Math.sqrt(cue.size / ref.source.size))) : 1;
    const parts = section.tracks.flatMap(track => track.notes.flatMap(note => noteParts(track, { ...note, duration: note.duration * durationScale }, beatMs).map(part => ({
      ...part, bus: "sfx" as const, at: note.at * beatMs * durationScale + (part.at ?? 0),
      gain: part.gain * gainScale,
    }))));
    // The exported reference contains one die/dart; the game supplies how many are in flight.
    const maximum = cue.sfx === 'dice.roll' ? 3 : cue.sfx === 'spell.bolt' && cue.element === 'force' ? 64 : 1;
    const count = Math.max(1, Math.min(maximum, Math.round((cue.count ?? ref.source?.count ?? 1) / (ref.source?.count ?? 1))));
    if (count === 1) return parts;
    return Array.from({ length: count }, (_, index) => parts.map(part => ({ ...part, at: (part.at ?? 0) + index * (cue.sfx === 'dice.roll' ? 30 : 90) }))).flat();
  }

}

const pair = (n: number) => ({ l: new Float32Array(n), r: new Float32Array(n) });

/** Volumes kept in bounds (the buses' 0 to 1, the master's to MOST_MASTER), and only the numbers. */
function clean(v: Partial<Volumes>): Partial<Volumes> {
  const out: Partial<Volumes> = {};
  for (const key of ["master", "sfx", "voice", "music"] as const) {
    const x = v[key];
    if (typeof x === "number" && Number.isFinite(x)) out[key] = Math.max(0, Math.min(key === "master" ? MOST_MASTER : 1, x));
  }
  return out;
}
