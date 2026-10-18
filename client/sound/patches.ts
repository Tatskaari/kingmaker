// New: every sound effect the game makes, as recipes of parts (docs/sound-design.md): the menus, the dice, the story's moments, spells by their element, blows by what they're struck with, and what happens to the world (fire, water, things breaking). Each is made afresh from a seed, so no two dice rolls or sword blows are quite alike, and none needs a recording.
import { hz, rng, type Env, type Wave } from "./dsp.ts";
import type { NoiseSpec, PartSpec, PluckSpec, ToneSpec } from "./parts.ts";

/** The sound effects, by what they're for. */
export const SFX = [
  // The menus, and the box.
  "ui.move", "ui.choose", "ui.back", "ui.open", "ui.close", "ui.denied", "ui.send", "ui.page", "ui.bump",
  // The dice: rolled, and how a check went.
  "dice.roll", "dice.success", "dice.failure", "dice.crit", "dice.fumble",
  // The story: a scene opening, a scene ended, The End, someone noticing something.
  "story.scene", "story.ended", "story.end", "story.alert",
  // Spells (an element each): cast, a bolt in flight, where it lands, an area, healing.
  "spell.cast", "spell.bolt", "spell.hit", "spell.area", "spell.heal",
  // Blows: a swing, a shot, a hit (by its damage), a miss, a parry, a fall, a step, running off.
  "blow.swing", "blow.shot", "blow.hit", "blow.miss", "blow.parry", "blow.fall", "blow.step", "blow.flee",
  // A fight: it starts, the player's turn comes, won, lost.
  "fight.start", "fight.turn", "fight.won", "fight.lost",
  // The world: what the director plays when the world changes.
  "world.explosion", "world.ignite", "world.splash", "world.douse", "world.steam", "world.debris", "world.poof", "world.sparks", "world.freeze",
] as const;

export type Sfx = (typeof SFX)[number];

/** A sound effect asked for, with what it needs to know. */
export interface Cue {
  sfx: Sfx;
  /** A spell's element (fire, cold, lightning, thunder, acid, poison, necrotic, radiant, force, psychic, heal); a hit's when the damage is one. */
  element?: string;
  /** A blow's weapon (a blade, something blunt, a bite, a bow); a hit's damage type (slashing, piercing, bludgeoning). */
  kind?: string;
  /** An area's or a blast's size, in feet. */
  size?: number;
  /** A flight's time (a bolt, a shot), in ms: its whoosh lasts that long. */
  ms?: number;
  critical?: boolean;
  /** How many: darts, dice. */
  count?: number;
  /** The same seed, the same sound (a test's); else a fresh one. */
  seed?: number;
}

/** How a person sounds when they speak (voices.ts): each blip of their talk is one of these. */
export interface Voice {
  /** Their pitch, Hz. */
  pitch: number;
  wave: Wave;
  duty?: number;
  /** How far their pitch moves with the letters, in semitones: a flat voice 1, a lively one 7. */
  range: number;
  /** A blip's length, ms. */
  length: number;
  /** Dull (0) to bright (1). */
  bright: number;
  gain: number;
  /** A growl (a dog's, say): how much noise is in it, 0 to 1. */
  rough?: number;
  /** A blip every this many letters of a word (and on its first): 2 unless it says, the narrator's 3. */
  every?: number;
}

// ---------------------------------------------------------------------------------------------
// Parts, in short.

const tone = (wave: Wave, freq: number, env: Env, gain: number, more: Partial<ToneSpec> = {}): ToneSpec => ({ kind: "tone", wave, freq, env, gain, ...more });
const noise = (filter: NoiseSpec["filter"], freq: number, env: Env, gain: number, more: Partial<NoiseSpec> = {}): NoiseSpec => ({ kind: "noise", filter, freq, env, gain, ...more });
const pluck = (freq: number, decay: number, gain: number, more: Partial<PluckSpec> = {}): PluckSpec => ({ kind: "pluck", freq, decay, gain, env: {}, ...more });
/** A bell: a sine bent by another, the bend falling away (a ratio of 3.5 is glassy, 2 a chime, 1.4 a gong). */
const bell = (freq: number, gain: number, ring = 900, ratio = 3.5, index = 2, more: Partial<ToneSpec> = {}): ToneSpec => tone("sine", freq, { a: 2, d: ring }, gain, { fm: { ratio, index, fall: ring * 0.5 }, ...more });
/** Parts moved later by `ms`. */
const later = (ms: number, parts: PartSpec[]): PartSpec[] => parts.map(p => ({ ...p, at: (p.at ?? 0) + ms }));
/** Parts louder or quieter. */
const scaled = (k: number, parts: PartSpec[]): PartSpec[] => parts.map(p => ({ ...p, gain: p.gain * k }));
/** Parts with some of them in the room. */
const roomy = (room: number, parts: PartSpec[]): PartSpec[] => parts.map(p => ({ ...p, room: p.room ?? room }));

/** A note by name: "C4" is middle C, "F#5", "Bb3". */
export function note(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"];
  return hz(12 * (Number(m[3]) + 1) + base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0));
}
const N = note;

// ---------------------------------------------------------------------------------------------
// The recipes.

/** A cue's parts, from its seed. */
export function patchOf(cue: Cue, seed: number): PartSpec[] {
  const r = rng(cue.seed ?? seed);
  switch (cue.sfx) {
    case "ui.move": return [tone("triangle", N("E6"), { a: 1, d: 35 }, 0.11), tone("pulse", N("E7"), { a: 1, d: 12 }, 0.02, { duty: 0.25 })];
    case "ui.choose": return roomy(0.15, [
      tone("pulse", N("C6"), { a: 1, d: 70 }, 0.075, { duty: 0.25, lp: 4000 }),
      tone("pulse", N("G6"), { a: 1, d: 150 }, 0.075, { duty: 0.25, lp: 4000, at: 55 }),
      tone("sine", N("C7"), { a: 2, d: 180 }, 0.03, { at: 55 }),
    ]);
    case "ui.back": return [tone("triangle", N("G5"), { a: 1, d: 60 }, 0.1), tone("triangle", N("C5"), { a: 1, d: 110 }, 0.1, { at: 50 })];
    case "ui.open": return [tone("triangle", 660, { a: 2, d: 110 }, 0.08, { to: 1320, glide: 70 }), noise("hp", 3000, { a: 10, d: 60 }, 0.03)];
    case "ui.close": return [tone("triangle", 1100, { a: 2, d: 100 }, 0.065, { to: 550, glide: 70 }), noise("hp", 2500, { a: 5, d: 50 }, 0.025)];
    case "ui.denied": return [
      tone("pulse", 196, { a: 2, s: 1, hold: 70, r: 20 }, 0.08, { duty: 0.25, lp: 1200 }),
      tone("pulse", 185, { a: 2, s: 1, hold: 90, r: 30 }, 0.08, { duty: 0.25, lp: 1200, at: 95 }),
    ];
    case "ui.send": return [tone("sine", 520, { a: 2, d: 90 }, 0.07, { to: 1040, glide: 60 }), noise("bp", 2200, { a: 8, d: 70 }, 0.04, { q: 1.5 })];
    case "ui.page": return [noise("bp", 3500, { a: 15, d: 140 }, 0.07, { q: 0.9 }), noise("bp", 5000, { a: 5, d: 160 }, 0.05, { crackle: 300 })];
    case "ui.bump": return [tone("square", 110, { a: 1, d: 70 }, 0.09, { to: 70, lp: 700 }), noise("lp", 600, { a: 1, d: 40 }, 0.05)];
    case "dice.roll": return diceRoll(cue.count ?? 1, r);
    case "dice.success": return roomy(0.25, [bell(N("E5"), 0.06, 700, 2, 1.2), bell(N("B5"), 0.06, 800, 2, 1.2, { at: 90 })]);
    case "dice.failure": return [
      tone("triangle", N("E4"), { a: 5, s: 1, hold: 120, r: 80 }, 0.07, { to: N("D#4"), glide: 200 }),
      tone("triangle", N("D4"), { a: 5, s: 1, hold: 200, r: 150 }, 0.06, { to: N("C#4"), glide: 300, at: 160 }),
    ];
    case "dice.crit": return roomy(0.35, [
      ...["C5", "E5", "G5", "C6"].map((n, i) => tone("pulse", N(n), { a: 1, d: 160 }, 0.06, { duty: 0.25, lp: 5000, at: i * 70 })),
      ...["C6", "E6", "G6"].map(n => tone("pulse", N(n), { a: 2, s: 0.7, hold: 350, r: 300 }, 0.04, { duty: 0.25, lp: 5000, at: 280 })),
      bell(N("C7"), 0.05, 1000, 2, 1, { at: 280 }),
    ]);
    case "dice.fumble": return [
      tone("saw", N("G3"), { a: 10, s: 1, hold: 220, r: 60 }, 0.06, { to: N("F#3"), glide: 220, lp: 900, q: 2 }),
      tone("saw", N("F#3"), { a: 10, s: 1, hold: 260, r: 60 }, 0.06, { to: N("F3"), glide: 260, lp: 900, q: 2, at: 300 }),
      tone("saw", N("F3"), { a: 10, s: 1, hold: 600, r: 300 }, 0.06, { to: N("E3"), glide: 500, lp: 800, q: 2, vib: { rate: 7, depth: 0.6, after: 200 }, at: 640 }),
    ];
    case "story.scene": return roomy(0.4, ["D4", "E4", "G4", "A4", "B4", "D5", "E5"].map((n, i) => pluck(N(n), 1.6, 0.08, { bright: 0.6, at: i * 45, pan: -0.4 + i * 0.13 })));
    case "story.ended": return roomy(0.4, [
      ...["D3", "A3", "D4", "F#4", "A4"].map((n, i) => pluck(N(n), 2.4, 0.08, { bright: 0.45, at: i * 35, pan: -0.3 + i * 0.15 })),
      bell(N("D5"), 0.03, 1600, 2, 0.8, { at: 160 }),
    ]);
    case "story.end": return theEnd();
    case "story.alert": return roomy(0.2, [
      tone("pulse", N("B6"), { a: 1, d: 45 }, 0.05, { duty: 0.125, lp: 6000 }),
      tone("pulse", N("E7"), { a: 1, d: 120 }, 0.05, { duty: 0.125, lp: 6000, at: 60 }),
    ]);
    case "spell.cast": return spellCast(cue.element, r);
    case "spell.bolt": return spellBolt(cue.element, cue.ms ?? 300, cue.count ?? 1, r);
    case "spell.hit": return spellHit(cue.element, 1, r);
    case "spell.area": return spellArea(cue.element, cue.size ?? 15, r);
    case "spell.heal": return heal(r);
    case "blow.swing": return swing(cue.kind ?? "", r);
    case "blow.shot": return shot(cue.kind ?? "", cue.ms ?? 300);
    case "blow.hit": return hit(cue.kind ?? "", cue.element, cue.critical ?? false, r);
    case "blow.miss": return [noise("hp", 1800, { a: 20, d: 80 }, 0.05, { to: 3000, sweep: 90 })];
    case "blow.parry": return roomy(0.25, [noise("hp", 4000, { a: 0.3, d: 30 }, 0.1), tone("sine", 1200 + r() * 300, { a: 1, d: 400 }, 0.07, { fm: { ratio: 2.76, index: 3, fall: 250 } })]);
    case "blow.fall": return [
      tone("sine", 95, { a: 2, d: 260 }, 0.22, { to: 42 }),
      noise("lp", 500, { a: 5, d: 200 }, 0.1),
      noise("lp", 350, { a: 5, d: 150 }, 0.06, { at: 120 }),
    ];
    case "blow.step": return [noise("lp", 1100, { a: 1, d: 24 }, 0.035, { pan: (r() - 0.5) * 0.4 }), tone("sine", 140, { a: 1, d: 30 }, 0.03, { to: 90 })];
    case "blow.flee": return [noise("bp", 900, { a: 20, d: 200 }, 0.05, { to: 2200 }), ...[0, 110, 220].flatMap(t => later(t + 60, [noise("lp", 1100, { a: 1, d: 24 }, 0.03)]))];
    case "fight.start": return roomy(0.4, [
      tone("sine", 150, { a: 1, d: 180 }, 0.3, { to: 45 }),
      tone("sine", 150, { a: 1, d: 200 }, 0.3, { to: 45, at: 220 }),
      ...["E2", "B2", "E3"].map(n => tone("saw", N(n), { a: 10, s: 1, hold: 500, r: 300 }, 0.045, { detune: 15, lp: 900, at: 220 })),
      noise("hp", 6000, { a: 1, d: 900 }, 0.05, { at: 220 }),
    ]);
    case "fight.turn": return roomy(0.3, [bell(N("A5"), 0.055, 500, 2, 1), bell(N("D6"), 0.055, 600, 2, 1, { at: 80 })]);
    case "fight.won": return roomy(0.3, [
      ...["G4", "C5", "E5", "G5"].map((n, i) => tone("pulse", N(n), { a: 1, d: 150 }, 0.06, { duty: 0.25, lp: 4500, at: i * 90 })),
      tone("pulse", N("C6"), { a: 2, s: 0.8, hold: 500, r: 300 }, 0.06, { duty: 0.25, lp: 4500, at: 360 }),
      tone("triangle", N("C4"), { a: 5, s: 0.8, hold: 800, r: 300 }, 0.1, { at: 360 }),
      bell(N("C7"), 0.04, 1000, 2, 1, { at: 360 }),
    ]);
    case "fight.lost": return roomy(0.3, ["E4", "D4", "C4", "B3"].map((n, i) => tone("triangle", N(n), { a: 5, s: 0.8, hold: 240, r: 200 }, 0.08, { at: i * 220 })));
    case "world.explosion": return roomy(0.5, [...scaled(1.2, spellArea("fire", Math.max(15, cue.size ?? 20), r)), noise("lp", 3000, { a: 2, d: 900 }, 0.08, { crackle: 120 })]);
    case "world.ignite": return roomy(0.3, [
      noise("lp", 200, { a: 60, s: 1, hold: 120, r: 300 }, 0.15, { to: 2200, sweep: 180 }),
      noise("hp", 1500, { a: 20, d: 1200 }, 0.07, { crackle: 50 }),
      noise("lp", 400, { a: 100, d: 1300 }, 0.05),
    ]);
    case "world.splash": return splash(r);
    case "world.douse": return [...splash(r), noise("hp", 4000, { a: 60, d: 900 }, 0.06, { at: 80 })];
    case "world.steam": return [noise("hp", 3500, { a: 80, d: 900 }, 0.06)];
    case "world.debris": return debris(r);
    case "world.poof": return [noise("lp", 900, { a: 25, d: 140 }, 0.05)];
    case "world.sparks": return [noise("hp", 4000, { a: 1, d: 250 }, 0.07, { crackle: 300 }), tone("pulse", 2400, { a: 1, d: 40 }, 0.03, { duty: 0.125, to: 1200 })];
    case "world.freeze": return scaled(0.7, spellHit("cold", 1, r));
  }
}

/** Dice thrown: knocks that come quicker as they settle, each a little quieter, skittering from side to side. */
function diceRoll(count: number, r: () => number): PartSpec[] {
  const parts: PartSpec[] = [];
  for (let d = 0; d < Math.min(3, Math.max(1, count)); d++) {
    let t = d * 30 + r() * 20, gap = 70 + r() * 20, k = 1;
    const bounces = 5 + Math.floor(r() * 3);
    for (let b = 0; b < bounces; b++) {
      const pan = (r() - 0.5) * 0.6;
      parts.push(noise("bp", 2200 + r() * 2200, { a: 0.5, d: 8 + r() * 8 }, 0.16 * k, { q: 3, at: t, pan, room: 0.15 }));
      parts.push(tone("sine", 700 + r() * 900, { a: 0.5, d: 18 }, 0.05 * k, { at: t, pan }));
      t += gap;
      gap *= 0.72 + r() * 0.1;
      k *= 0.85;
    }
    parts.push(noise("bp", 1500, { a: 0.5, d: 14 }, 0.08 * k, { q: 2, at: t + 20 }));
  }
  return parts;
}

/** The End: a rolled chord a bar, home at last, a bell over it. */
function theEnd(): PartSpec[] {
  const chords = [["C4", "E4", "G4", "C5"], ["F3", "A4", "C5", "F5"], ["G3", "B4", "D5", "G5"], ["C3", "E4", "G4", "C5", "E5"]];
  return roomy(0.45, [
    ...chords.flatMap((chord, c) => chord.map((n, i) => pluck(N(n), 2.6, 0.075, { bright: 0.5, at: c * 450 + i * 40, pan: -0.3 + i * 0.15 }))),
    ...["E5", "F5", "G5", "C6"].map((n, i) => bell(N(n), 0.035, i === 3 ? 1800 : 600, 2, 0.8, { at: i * 450 + 120 })),
    tone("triangle", N("C3"), { a: 300, s: 1, hold: 1500, r: 900 }, 0.05, { detune: 6, at: 1350 }),
  ]);
}

/** A few high pings at random, a little apart: sparkle. */
function pings(r: () => number, count: number, low: number, high: number, gain: number, over: number): PartSpec[] {
  return Array.from({ length: count }, () => tone("sine", low + r() * (high - low), { a: 1, d: 90 + r() * 90 }, gain, { at: r() * over, pan: (r() - 0.5) * 0.8 }));
}

/** Bubbles: little rising blips (acid, poison). */
function bubbles(r: () => number, count: number, low: number, over: number, gain: number): PartSpec[] {
  return Array.from({ length: count }, () => {
    const f = low + r() * low * 0.8;
    return tone("sine", f, { a: 2, d: 50 }, gain, { to: f * 2.2, glide: 45, at: r() * over, pan: (r() - 0.5) * 0.6 });
  });
}

/** A spell being cast: its element's sound before it goes. */
function spellCast(element: string | undefined, r: () => number): PartSpec[] {
  switch (element) {
    case "fire": return [noise("bp", 600, { a: 30, d: 300 }, 0.12, { to: 2400, q: 1.2 }), noise("lp", 6000, { a: 5, d: 400 }, 0.08, { crackle: 40 })];
    case "cold": return [...Array.from({ length: 8 }, (_, i) => tone("sine", [1568, 1760, 2093, 2349, 2637, 3136][Math.floor(r() * 6)]!, { a: 1, d: 120 }, 0.035, { at: i * 25 })), noise("hp", 6000, { a: 40, d: 300 }, 0.04)];
    case "lightning": return [tone("saw", 60, { a: 5, s: 1, hold: 160, r: 40 }, 0.06, { vib: { rate: 31, depth: 3 }, lp: 2500 }), noise("hp", 2000, { a: 5, d: 160 }, 0.06, { crackle: 200 })];
    case "thunder": return [noise("lp", 300, { a: 150, s: 1, hold: 150, r: 100 }, 0.08)];
    case "necrotic": return roomy(0.4, [noise("bp", 1800, { a: 200, d: 400 }, 0.04, { q: 4 }), tone("sine", 55, { a: 150, d: 400 }, 0.08)]);
    case "radiant": case "heal": return roomy(0.4, pings(r, 5, 2000, 4000, 0.03, 200));
    case "psychic": return roomy(0.4, [tone("sine", 520, { a: 40, d: 250 }, 0.04, { vib: { rate: 9, depth: 2 } })]);
    default: return roomy(0.35, [...pings(r, 6, 1800, 4200, 0.03, 250), noise("hp", 5000, { a: 60, d: 200 }, 0.025)]);
  }
}

/** A spell in flight for `ms`: its rush, and a dart's whine for each of `count`. */
function spellBolt(element: string | undefined, ms: number, count: number, r: () => number): PartSpec[] {
  const hold = Math.max(60, ms);
  switch (element) {
    case "fire": return [noise("lp", 900, { a: 20, s: 1, hold, r: 80 }, 0.1, { to: 2500, sweep: hold }), tone("saw", 90, { a: 20, s: 1, hold, r: 80 }, 0.03, { lp: 300 })];
    case "cold": return [noise("hp", 3000, { a: 20, s: 1, hold, r: 60 }, 0.05, { to: 6000, sweep: hold }), ...Array.from({ length: Math.ceil(hold / 40) }, (_, i) => tone("sine", 2000 + r() * 1500, { a: 1, d: 60 }, 0.02, { at: i * 40 }))];
    case "force": return Array.from({ length: Math.max(1, count) }, (_, k) => tone("pulse", 1800, { a: 1, d: Math.max(140, hold) }, 0.065, { duty: 0.25, to: 420, glide: Math.max(130, hold), lp: 6000, at: k * 90 }));
    case "acid": case "poison": return [noise("bp", 1200, { a: 30, s: 1, hold, r: 60 }, 0.05, { q: 2, to: 600, sweep: hold }), ...bubbles(r, 4, 300, hold, 0.04)];
    case "necrotic": return roomy(0.4, [tone("saw", 110, { a: 40, s: 1, hold, r: 120 }, 0.05, { detune: 30, lp: 700, to: 82 })]);
    case "psychic": return roomy(0.4, [tone("sine", 600, { a: 20, s: 1, hold, r: 100 }, 0.05, { vib: { rate: 11, depth: 3 } })]);
    case "radiant": return roomy(0.4, [tone("sine", 1318, { a: 20, s: 1, hold, r: 100 }, 0.04, { fm: { ratio: 2, index: 1, fall: hold } }), ...pings(r, 3, 2500, 4000, 0.02, hold)]);
    default: return [noise("bp", 1400, { a: 20, s: 1, hold, r: 60 }, 0.06, { q: 1.5, to: 3000, sweep: hold })];
  }
}

/** Where a spell lands, by its element (`k` its size: a hit's 1). */
function spellHit(element: string | undefined, k: number, r: () => number): PartSpec[] {
  switch (element) {
    case "fire": return roomy(0.3, [
      noise("lp", 4000, { a: 2, d: 600 * k }, 0.22, { to: 250, sweep: 500 * k }),
      tone("sine", 110, { a: 1, d: 220 }, 0.3, { to: 45 }),
      noise("lp", 7000, { a: 2, d: 800 * k }, 0.1, { crackle: 60 }),
    ]);
    case "cold": return roomy(0.35, [
      noise("hp", 4000, { a: 0.5, d: 40 }, 0.15),
      ...[2093, 2637, 3136].map((f, i) => bell(f, 0.045, 600, 3.7, 3, { at: i * 20, pan: (i - 1) * 0.4 })),
      ...pings(r, 4, 3000, 5000, 0.02, 300),
    ]);
    case "lightning": return roomy(0.4, [
      noise("hp", 1500, { a: 0.3, d: 60 }, 0.3),
      ...Array.from({ length: 6 }, (_, i) => tone("pulse", 300 + r() * 2100, { a: 0.5, d: 22 }, 0.05, { duty: 0.125, at: i * 14 })),
      noise("lp", 250, { a: 30, d: 900 * k }, 0.12),
    ]);
    case "thunder": return roomy(0.5, [
      noise("lp", 600, { a: 5, d: 1200 * k }, 0.3, { to: 90, sweep: 700 }),
      tone("sine", 70, { a: 2, d: 500 }, 0.35, { to: 32 }),
      noise("lp", 400, { a: 10, d: 700 * k }, 0.08, { grain: 800 }),
    ]);
    case "acid": return [...bubbles(r, 8, 280, 400, 0.06), noise("hp", 3500, { a: 30, d: 350 }, 0.05)];
    case "poison": return roomy(0.2, [tone("saw", 98, { a: 60, s: 1, hold: 380, r: 200 }, 0.06, { detune: 25, lp: 700, vib: { rate: 5.5, depth: 0.8 } }), ...bubbles(r, 4, 180, 400, 0.04)]);
    case "necrotic": return roomy(0.5, [
      tone("saw", 110, { a: 200, s: 1, hold: 500, r: 300 }, 0.07, { detune: 30, to: 73, glide: 700, lp: 900, lpTo: 300, sweep: 700 }),
      noise("bp", 1800, { a: 200, d: 700 }, 0.04, { q: 4 }),
      tone("sine", 55, { a: 100, d: 900 }, 0.1),
    ]);
    case "radiant": return roomy(0.5, [
      ...["E5", "G#5", "B5"].map((n, i) => bell(N(n), 0.055, 1200, 2, 1.2, { at: i * 40, pan: (i - 1) * 0.3 })),
      ...pings(r, 6, 2000, 4000, 0.025, 300),
      tone("triangle", N("E4"), { a: 150, s: 1, hold: 400, r: 600 }, 0.04, { detune: 8 }),
    ]);
    case "force": return [noise("bp", 1200, { a: 0.5, d: 50 }, 0.08, { q: 2 }), tone("sine", 220, { a: 1, d: 70 }, 0.06, { to: 110 })];
    case "psychic": return roomy(0.5, [
      tone("sine", 520, { a: 40, s: 1, hold: 350, r: 250 }, 0.06, { vib: { rate: 9, depth: 2.5 }, fm: { ratio: 1.41, index: 1.5, fall: 600 } }),
      tone("sine", 780, { a: 60, s: 1, hold: 300, r: 250 }, 0.04, { vib: { rate: 7, depth: 2 } }),
    ]);
    case "heal": return heal(r);
    default: return roomy(0.35, [...pings(r, 8, 1800, 4200, 0.035, 350), bell(1318, 0.03, 600, 2, 1)]);
  }
}

/** A spell over an area of `size` feet: its hit, bigger, and for the elements that blow up, a crunch and a deeper boom. */
function spellArea(element: string | undefined, size: number, r: () => number): PartSpec[] {
  const k = Math.min(2, 0.8 + size / 30);
  if (element === "fire") return roomy(0.45, [
    noise("lp", 3000, { a: 2, d: 700 + size * 25 }, 0.26, { to: 120, sweep: 500 + size * 20 }),
    tone("sine", 80, { a: 1, d: 400 }, 0.35, { to: 30 }),
    noise("lp", 7000, { a: 2, d: 1200 }, 0.1, { crackle: 70 }),
    noise("lp", 1500, { a: 1, d: 300 }, 0.1, { grain: 3000 }),
  ]);
  if (element === "cold") return [...spellHit("cold", k, r), noise("bp", 1200, { a: 100, d: 900 }, 0.08, { to: 400, q: 0.8 })];
  return spellHit(element, k, r);
}

/** Healing: a rising arpeggio of soft bells, and a little sparkle. */
function heal(r: () => number): PartSpec[] {
  return roomy(0.4, [...["C5", "E5", "G5", "C6"].map((n, i) => bell(N(n), 0.05, 900, 2, 0.8, { at: i * 70 })), ...pings(r, 4, 2500, 4500, 0.02, 400)]);
}

/** A weapon's kind of blow, from its style (blade, blunt, bite) or its name (a club is blunt, jaws bite). */
function styleOf(weapon: string): "blade" | "blunt" | "bite" | "shove" {
  if (/bite|claw|fang|talon|jaw|maw/i.test(weapon)) return "bite";
  if (/shove|unarmed|fist|punch|kick|grapple/i.test(weapon)) return "shove";
  if (/blunt|club|mace|hammer|staff|cudgel|maul|flail/i.test(weapon)) return "blunt";
  return "blade";
}

/** A blow's swing, by the weapon: a blade's thin whoosh, a club's heavier one, a bite's snap, a shove's push. */
function swing(kind: string, r: () => number): PartSpec[] {
  const k = styleOf(kind);
  if (k === "bite") return [noise("bp", 1500, { a: 5, d: 40 }, 0.08, { q: 2 }), noise("bp", 1500, { a: 5, d: 40 }, 0.08, { q: 2, at: 70 }), tone("square", 120, { a: 1, d: 60 }, 0.04, { lp: 600, at: 70 })];
  if (k === "blunt") return [noise("bp", 400, { a: 50, d: 140 }, 0.13, { to: 1100, q: 1.5 })];
  if (k === "shove") return [noise("bp", 600, { a: 30, d: 90 }, 0.09, { to: 1400 })];
  return [noise("bp", 900 + r() * 200, { a: 40, d: 110 }, 0.12, { to: 3200, sweep: 140, q: 2.5 })];
}

/** A shot for `ms`: a bow's twang and the arrow's hiss, or a throw's whoosh. */
function shot(kind: string, ms: number): PartSpec[] {
  const hold = Math.max(60, ms);
  if (/bow/i.test(kind)) return [pluck(98, 0.25, 0.12, { bright: 0.9 }), noise("hp", 2500, { a: 20, s: 1, hold, r: 30 }, 0.04, { to: 4500, sweep: hold })];
  return [noise("bp", 700, { a: 20, s: 1, hold, r: 40 }, 0.06, { to: 1600, sweep: hold })];
}

/** A hit landing, by its damage: a slash's hiss, a stab's click, a club's thud; an element's own; a critical with a crack and a ring. */
function hit(kind: string, element: string | undefined, critical: boolean, r: () => number): PartSpec[] {
  const type = (element ?? kind).toLowerCase();
  let parts: PartSpec[];
  if (type === "slashing") parts = [noise("bp", 2800, { a: 0.5, d: 70 }, 0.16, { q: 1.5 }), tone("saw", 380, { a: 0.5, d: 60 }, 0.06, { to: 140, lp: 2000 }), tone("sine", 120, { a: 1, d: 90 }, 0.14, { to: 60 })];
  else if (type === "piercing") parts = [noise("bp", 1800, { a: 0.3, d: 35 }, 0.15, { q: 3 }), tone("sine", 150, { a: 1, d: 70 }, 0.12, { to: 70 })];
  else if (["fire", "cold", "lightning", "thunder", "acid", "poison", "necrotic", "radiant", "force", "psychic"].includes(type)) parts = scaled(0.6, spellHit(type, 0.7, r));
  else parts = [tone("sine", 130, { a: 1, d: 160 }, 0.28, { to: 48 }), noise("lp", 900, { a: 1, d: 90 }, 0.14), noise("lp", 1500, { a: 1, d: 60 }, 0.05, { grain: 2000 })];
  if (!critical) return parts;
  return roomy(0.3, [...scaled(1.3, parts), noise("hp", 3000, { a: 0.2, d: 50 }, 0.14), tone("pulse", 1568, { a: 1, d: 160 }, 0.03, { duty: 0.125, at: 20 })]);
}

/** Water: a splash falling away, and droplets after it. */
function splash(r: () => number): PartSpec[] {
  return [
    noise("bp", 1500, { a: 2, d: 220 }, 0.14, { to: 500, q: 1 }),
    ...Array.from({ length: 6 }, () => {
      const f = 1200 + r() * 1400;
      return tone("sine", f, { a: 1, d: 30 }, 0.04, { to: f * 1.6, glide: 30, at: 40 + r() * 360, pan: (r() - 0.5) * 0.6 });
    }),
  ];
}

/** Something breaking: crunches, knocks of wood, a thud under them. */
function debris(r: () => number): PartSpec[] {
  return [
    ...Array.from({ length: 5 }, () => noise("lp", 2500, { a: 1, d: 50 }, 0.09, { grain: 1500 + r() * 2000, at: r() * 300, pan: (r() - 0.5) * 0.5 })),
    ...Array.from({ length: 3 }, () => tone("sine", 200 + r() * 300, { a: 1, d: 40 }, 0.06, { at: r() * 300 })),
    tone("sine", 90, { a: 1, d: 150 }, 0.12, { to: 45 }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Voices.

/** Where a letter sits in a voice's range: vowels up, consonants about, so talk rises and falls like speech (in semitones, centred). */
const STEPS = [0, 2, 3, 5, 7, 9, 10, 12];
function letterStep(letter: string, range: number): number {
  const c = letter.toLowerCase().charCodeAt(0);
  const i = c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? c - 48 : 3;
  const vowel = "aeiouy".includes(letter.toLowerCase());
  const step = STEPS[(i * 3 + (vowel ? 5 : 0)) % STEPS.length]!;
  return (step / 12 - 0.5) * range;
}

/** One blip of someone's talk: a short tone at a letter's pitch in their voice, a growl in it for a creature. */
export function blipOf(voice: Voice, letter: string, seed: number): PartSpec[] {
  const r = rng(seed);
  const f = voice.pitch * 2 ** ((letterStep(letter, voice.range) + (r() - 0.5) * 0.5) / 12);
  const env: Env = { a: 2, s: 1, hold: voice.length * 0.6, r: voice.length * 0.4 };
  const parts: PartSpec[] = [tone(voice.wave, f, env, voice.gain, { bus: "voice", ...(voice.duty ? { duty: voice.duty } : {}), lp: Math.min(9000, f * (2 + 10 * voice.bright)), to: f * 0.97 })];
  if (voice.rough) parts.push(noise("bp", f * 2.5, { a: 2, d: voice.length }, voice.gain * voice.rough * 2, { q: 1.2, bus: "voice" }));
  return parts;
}
