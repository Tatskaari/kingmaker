import { DAMAGE_COLOR, FLAME_LIGHT, FLAME_RAMPS, mix, ramp, rgbOf, type FlameName, type RGB } from "./color.ts";
import { clamp01, hash01, noise3, rng, smoothstep } from "./noise.ts";

/**
 * Effects for events: particles, shockwaves, flashes and floating text, in the world's feet.
 *
 *   const fx = new Effects();
 *   fx.effect("fireball", { from: caster, at: elm, radius: 20 });
 *   fx.effect("bolt", { from, to, color: "#9ad8ff" });
 *   fx.effect("explosion", { at, radius: 15 });
 *   fx.effect("splash", { at });                 // also: sparks, smoke, steam, shockwave, flash, throw, douse, ignite, debris, poof
 *   fx.float(elm, "28", { damage: "fire" });     // a damage number that rises and fades
 *   fx.bark("kell", "Was that strictly necessary?");
 *   fx.alert("cob");                             // a "!" over his head
 *   const frame = fx.frame(now, id => positionOf(world, id));   // what to draw this instant
 *
 * Particles are analytic: each knows where it starts, how it moves (drag, gravity, buoyancy, the
 * wind) and when it was born, so its state at any time is a formula, not a simulation. A frame at
 * time t is exact however you got there; headless dumps and tests can sample any instant. Effects
 * are brief (Cogmind's lesson: the dramatic ones get a second, the routine ones a few hundred
 * milliseconds) and nothing here blocks: callers can wait for `endsAt` if the story should pause.
 */

export interface Vec { x: number; y: number }
/** A place in the world (feet), or someone or something by id (their position is looked up each frame). */
export type Anchor = Vec | { id: string };

export type EffectKind = "fireball" | "bolt" | "explosion" | "splash" | "sparks" | "smoke" | "steam" | "dust" | "shockwave" | "flash" | "throw" | "douse" | "ignite" | "debris" | "poof" | "embers" | "lightning";

export interface EffectOptions {
  at?: Anchor;
  from?: Anchor;
  to?: Anchor;
  /** Feet. */
  radius?: number;
  color?: string;
  flame?: FlameName;
  /** Glyph for a thrown thing. */
  glyph?: string;
  /** More or fewer particles (1 = normal). */
  amount?: number;
  seed?: number;
  /** Start later than now (ms). */
  delay?: number;
}

export interface Sprite {
  x: number; y: number; z: number;
  glyph: string;
  fg: RGB;
  bg?: RGB;
  /** How much of bg to lay over what's there (smoke is translucent). */
  bgAlpha?: number;
  alpha: number;
  glow: boolean;
  /** 0 on the ground (ripples), 1 in the air, 2 high (smoke over everything). */
  layer: 0 | 1 | 2;
}

export type AreaKind = "ring" | "fire" | "flash";
export interface Area { kind: AreaKind; x: number; y: number; radius: number; width: number; t01: number; color: RGB; flame: FlameName; strength: number; seed: number }

export interface FloatText {
  x: number; y: number;
  /** Rows above the anchor's cell. */
  rows: number;
  text: string;
  fg: RGB;
  bg?: RGB;
  alpha: number;
  style: TextStyle;
  bold: boolean;
}
export type TextStyle = "damage" | "heal" | "bark" | "alert" | "info";

export interface EffectLight { x: number; y: number; radius: number; color: RGB; intensity: number }

export interface EffectFrame { sprites: Sprite[]; areas: Area[]; texts: FloatText[]; lights: EffectLight[]; shake: { dx: number; dy: number } }

interface Particle {
  born: number; life: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  drag: number; gravity: number; rise: number; wind: number;
  glyphs: string; colors: RGB[]; bg?: RGB[]; bgAlpha?: number;
  glow: boolean; layer: 0 | 1 | 2; fade: boolean;
  /** Follows a path instead (a bolt's head): from -> to over its life, with an arc; or sits at a fixed fraction of it, knocked sideways (a lightning stroke). */
  path?: { from: Anchor; to: Anchor; arc: number; at?: number; side?: number };
  anchor?: Anchor;
}
interface AreaFx { born: number; life: number; kind: AreaKind; at: Anchor; r0: number; r1: number; width: number; color: RGB; flame: FlameName; strength: number; seed: number }
interface TextFx { born: number; life: number; at: Anchor; text: string; color: RGB; style: TextStyle; rise: number; z: number }
interface LightFx { born: number; life: number; at: Anchor; radius: number; color: RGB; intensity: number; curve: "flash" | "glow" }
interface ShakeFx { born: number; life: number; amount: number }

const C = rgbOf;
const EMBER_RAMP = [C("#ffffff"), C("#fff0a0"), C("#ffc040"), C("#ff7a10"), C("#d03a08"), C("#6a1a08"), C("#2a1410")];
const SMOKE_RAMP = [C("#6a6670"), C("#5a5660"), C("#4a4750"), C("#3a3840")];
const STEAM_RAMP = [C("#ffffff"), C("#e8eef4"), C("#c8d0d8"), C("#9aa4ae")];
const WATER_RAMP = [C("#ffffff"), C("#c8ecff"), C("#7ab8e8"), C("#3a78b0")];
const DEBRIS_RAMP = [C("#d8c8a8"), C("#a08a6a"), C("#7a6a52"), C("#5a4e40")];
const SPARK_RAMP = [C("#ffffff"), C("#fff4b0"), C("#ffd060"), C("#ff9a30"), C("#a04010")];
const RING_RAMP = [C("#ffffff"), C("#fff0c0"), C("#ffc070"), C("#c07040"), C("#5a4038")];
const DUST_RAMP = [C("#f0e0b0"), C("#c8b080"), C("#9a8660"), C("#6a5e48")];

const isId = (a: Anchor): a is { id: string } => typeof (a as { id?: unknown }).id === "string";

export class Effects {
  private particles: Particle[] = [];
  private areas: AreaFx[] = [];
  private texts: TextFx[] = [];
  private lights: LightFx[] = [];
  private shakes: ShakeFx[] = [];
  private seq = 0;
  private readonly seed: number;
  /** The clock (ms). Pass your own for replays and tests. */
  now: () => number;
  /** Wind in feet per second: smoke and embers drift with it. */
  wind: Vec = { x: 1.5, y: -0.5 };

  constructor(options: { now?: () => number; seed?: number } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.seed = options.seed ?? 1;
  }

  /** Start an effect. Returns when it's over (callers that want the story to wait can). */
  effect(kind: EffectKind, opts: EffectOptions = {}, when?: number): { duration: number; endsAt: number } {
    const t0 = (when ?? this.now()) + (opts.delay ?? 0);
    const random = rng((opts.seed ?? this.seed) * 7919 + ++this.seq * 104729);
    const duration = this.spawn(kind, opts, t0, random);
    return { duration, endsAt: t0 + duration };
  }

  /** A number or a word that rises from someone or something and fades (damage, healing, "unharmed"). */
  float(at: Anchor, text: string, opts: { color?: string; damage?: string; style?: TextStyle; life?: number; delay?: number } = {}, when?: number): void {
    const style: TextStyle = opts.style ?? (opts.damage === "heal" ? "heal" : opts.damage ? "damage" : "info");
    const color = C(opts.color ?? (opts.damage ? DAMAGE_COLOR[opts.damage] ?? "#ff5a4a" : style === "info" ? "#f0e6c8" : "#ff5a4a"));
    this.texts.push({ born: (when ?? this.now()) + (opts.delay ?? 0), life: opts.life ?? (style === "info" ? 1700 : 1300), at, text, color, style, rise: style === "info" ? 1.2 : 2.4, z: 0 });
  }

  /** A short line of speech over a speaker's head for a few seconds (Qud-style). */
  bark(id: string, text: string, opts: { color?: string; life?: number; delay?: number } = {}, when?: number): void {
    const born = (when ?? this.now()) + (opts.delay ?? 0);
    // One bark per speaker at a time: a new line replaces the old.
    for (const t of this.texts) if (t.style === "bark" && isId(t.at) && t.at.id === id && t.born + t.life > born) t.life = Math.max(0, born - t.born);
    this.texts.push({ born, life: opts.life ?? Math.min(6000, 2200 + text.length * 55), at: { id }, text, color: C(opts.color ?? "#f2ead6"), style: "bark", rise: 0, z: 0 });
  }

  /** A "!" over someone who has just noticed something. */
  alert(id: string, opts: { text?: string; color?: string; delay?: number } = {}, when?: number): void {
    this.texts.push({ born: (when ?? this.now()) + (opts.delay ?? 0), life: 1300, at: { id }, text: opts.text ?? "!", color: C(opts.color ?? "#ffd75f"), style: "alert", rise: 0, z: 0 });
  }

  /** Is anything still playing? */
  busy(t = this.now()): boolean {
    return this.particles.some(p => p.born + p.life > t) || this.areas.some(a => a.born + a.life > t) || this.texts.some(x => x.born + x.life > t);
  }

  /** Forget everything that's over. */
  prune(t = this.now()): void {
    this.particles = this.particles.filter(p => p.born + p.life > t);
    this.areas = this.areas.filter(a => a.born + a.life > t);
    this.texts = this.texts.filter(x => x.born + x.life > t);
    this.lights = this.lights.filter(l => l.born + l.life > t);
    this.shakes = this.shakes.filter(s => s.born + s.life > t);
  }

  clear(): void { this.particles = []; this.areas = []; this.texts = []; this.lights = []; this.shakes = []; }

  /** What to draw at time t. Anchors that are ids are looked up with locate (people move). */
  frame(t: number, locate: (id: string) => Vec | undefined = () => undefined): EffectFrame {
    const where = (a: Anchor): Vec | undefined => (isId(a) ? locate(a.id) : a);
    const sprites: Sprite[] = [];
    for (const p of this.particles) {
      const age = t - p.born;
      if (age < 0 || age > p.life) continue;
      const s = age / 1000, f = age / p.life;
      let x: number, y: number, z: number;
      if (p.path) {
        const a = where(p.path.from), b = where(p.path.to);
        if (!a || !b) continue;
        const e = p.path.at ?? f;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const side = p.path.side ?? 0;
        x = a.x + (b.x - a.x) * e - ((b.y - a.y) / len) * side;
        y = a.y + (b.y - a.y) * e + ((b.x - a.x) / len) * side;
        z = p.z + p.path.arc * 4 * e * (1 - e);
      } else {
        const base = p.anchor ? where(p.anchor) ?? { x: p.x, y: p.y } : { x: p.x, y: p.y };
        const d = p.drag > 0 ? (1 - Math.exp(-p.drag * s)) / p.drag : s;
        x = base.x + p.vx * d + this.wind.x * p.wind * s;
        y = base.y + p.vy * d + this.wind.y * p.wind * s;
        z = p.z + p.vz * d + p.rise * s - 0.5 * p.gravity * s * s;
        if (z < 0) z = 0;
      }
      const gi = Math.min(p.glyphs.length - 1, Math.floor(f * p.glyphs.length));
      const fade = p.fade ? 1 - smoothstep(0.65, 1, f) : 1;
      sprites.push({
        x, y, z, glyph: p.glyphs[gi]!, fg: ramp(p.colors, f), ...(p.bg ? { bg: ramp(p.bg, f), bgAlpha: (p.bgAlpha ?? 0.5) * fade } : {}),
        alpha: fade, glow: p.glow, layer: p.layer,
      });
    }
    const areas: Area[] = [];
    for (const a of this.areas) {
      const age = t - a.born;
      if (age < 0 || age > a.life) continue;
      const at = where(a.at);
      if (!at) continue;
      const f = age / a.life;
      const ease = a.kind === "ring" ? 1 - (1 - f) ** 2.2 : a.kind === "fire" ? Math.min(1, f * 6) : 1;
      areas.push({ kind: a.kind, x: at.x, y: at.y, radius: a.r0 + (a.r1 - a.r0) * ease, width: a.width * (a.kind === "ring" ? 1 - 0.6 * f : 1), t01: f, color: a.color, flame: a.flame, strength: a.strength, seed: a.seed });
    }
    const texts: FloatText[] = [];
    for (const x of this.texts) {
      const age = t - x.born;
      if (age < 0 || age > x.life) continue;
      const at = where(x.at);
      if (!at) continue;
      const f = age / x.life;
      if (x.style === "bark") {
        const alpha = Math.min(smoothstep(0, 0.06, f), 1 - smoothstep(0.85, 1, f));
        texts.push({ x: at.x, y: at.y, rows: 2, text: x.text, fg: x.color, bg: C("#16141c"), alpha, style: "bark", bold: false });
      } else if (x.style === "alert") {
        const bob = Math.floor(age / 160) % 2;
        texts.push({ x: at.x, y: at.y, rows: 1 + bob, text: x.text, fg: x.color, alpha: 1 - smoothstep(0.8, 1, f), style: "alert", bold: true });
      } else {
        const rows = 1 + x.rise * (age / 1000);
        texts.push({ x: at.x, y: at.y, rows, text: x.text, fg: x.color, alpha: 1 - smoothstep(0.55, 1, f), style: x.style, bold: x.style !== "info" || x.text.length < 8 });
      }
    }
    const lights: EffectLight[] = [];
    for (const l of this.lights) {
      const age = t - l.born;
      if (age < 0 || age > l.life) continue;
      const at = where(l.at);
      if (!at) continue;
      const f = age / l.life;
      const k = l.curve === "flash" ? Math.min(1, age / 60) * Math.exp(-4.2 * f) : Math.sin(Math.PI * f);
      lights.push({ x: at.x, y: at.y, radius: l.radius * (0.7 + 0.3 * Math.min(1, age / 120)), color: l.color, intensity: l.intensity * k });
    }
    let dx = 0, dy = 0;
    for (const s of this.shakes) {
      const age = t - s.born;
      if (age < 0 || age > s.life) continue;
      const k = s.amount * (1 - age / s.life);
      dx += Math.round((hash01(Math.floor(age / 45), 1, s.born) - 0.5) * 2 * k);
      dy += Math.round((hash01(Math.floor(age / 45), 2, s.born) - 0.5) * k);
    }
    return { sprites, areas, texts, lights, shake: { dx, dy } };
  }

  // -------------------------------------------------------------------------------------------
  // The effects themselves.

  private spawn(kind: EffectKind, o: EffectOptions, t0: number, random: () => number): number {
    const amount = o.amount ?? 1;
    const n = (k: number) => Math.max(1, Math.round(k * amount));
    const at = o.at ?? o.to ?? { x: 0, y: 0 };
    const flame: FlameName = o.flame ?? "fire";
    const color = o.color ? C(o.color) : undefined;
    switch (kind) {
      case "fireball": {
        const radius = o.radius ?? 20;
        let t = t0;
        if (o.from) t += this.projectile(o.from, at, t0, random, { glyph: "●", colors: [C("#fff8d0"), C("#ffd060"), C("#ff8a20")], trail: FLAME_RAMPS[flame], speed: 95, arc: 3, glow: true });
        this.burst(at, radius, t, random, flame, amount);
        return t - t0 + 3200;
      }
      case "explosion": {
        const radius = o.radius ?? 15;
        this.burst(at, radius, t0, random, flame, amount * 1.3, true);
        // Debris thrown up and out, falling back.
        for (let i = 0; i < n(26); i++) {
          const a = random() * Math.PI * 2, sp = radius * (0.8 + random() * 1.6);
          this.particles.push(this.p(t0 + random() * 60, 900 + random() * 900, at, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 8 + random() * 22, drag: 1.2, gravity: 40, glyphs: random() < 0.5 ? ",'." : "∙,.", colors: DEBRIS_RAMP, layer: 1 }));
        }
        this.shakes.push({ born: t0, life: 420, amount: 2 });
        return 3800;
      }
      case "bolt": {
        const to = o.to ?? at;
        const from = o.from ?? at;
        const c = color ?? C("#9ad8ff");
        const travel = this.projectile(from, to, t0, random, { glyph: "*", colors: [C("#ffffff"), c], trail: [C("#ffffff"), c, mix(c, C("#000000"), 0.6)], speed: 130, arc: 0, glow: true });
        this.sparksAt(to, t0 + travel, random, n(12), [C("#ffffff"), c, mix(c, C("#202020"), 0.5)]);
        this.lights.push({ born: t0 + travel, life: 380, at: to, radius: 14, color: c, intensity: 1.2, curve: "flash" });
        return travel + 500;
      }
      case "lightning": {
        const to = o.to ?? at, from = o.from ?? at;
        const c = color ?? C("#e8f0ff");
        // A jagged line, there all at once, flickering for a moment.
        const steps = 28;
        let side = 0;
        for (let i = 0; i <= steps; i++) {
          side = i === 0 || i === steps ? 0 : Math.max(-3, Math.min(3, side + (random() - 0.5) * 2.2));
          this.particles.push({ ...this.p(t0, 200 + random() * 160, from, { glyphs: "#*'", colors: [C("#ffffff"), c, C("#6a7ab0")], layer: 1, glow: true }), path: { from, to, arc: 0, at: i / steps, side } });
        }
        this.lights.push({ born: t0, life: 300, at: to, radius: 26, color: c, intensity: 1.8, curve: "flash" });
        this.lights.push({ born: t0, life: 300, at: from, radius: 18, color: c, intensity: 1.2, curve: "flash" });
        this.sparksAt(to, t0, random, n(14), [C("#ffffff"), c, C("#4a5a90")]);
        return 600;
      }
      case "splash": case "douse": {
        const radius = o.radius ?? 4;
        const c = color ? [C("#ffffff"), color, mix(color, C("#000000"), 0.4)] : WATER_RAMP;
        for (let i = 0; i < n(kind === "douse" ? 22 : 14); i++) {
          const a = random() * Math.PI * 2, sp = radius * (0.6 + random() * 1.8);
          this.particles.push(this.p(t0 + random() * 80, 450 + random() * 450, at, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 6 + random() * 10, drag: 1.5, gravity: 34, glyphs: "'·.", colors: c, layer: 1 }));
        }
        // Ripples: thin rings (the "ember" flame marks a ripple, not a shockwave).
        this.areas.push({ born: t0, life: 650, kind: "ring", at, r0: 0.5, r1: radius * 1.1, width: 0.8, color: c[1] ?? C("#7ab8e8"), flame: "ember", strength: 0.75, seed: Math.floor(random() * 1e6) });
        this.areas.push({ born: t0 + 220, life: 600, kind: "ring", at, r0: 0.3, r1: radius * 0.7, width: 0.7, color: c[1] ?? C("#7ab8e8"), flame: "ember", strength: 0.55, seed: Math.floor(random() * 1e6) });
        if (kind === "douse") this.puffs(at, radius, t0 + 120, random, n(12), STEAM_RAMP, 7, 1600, 0.55);
        return 1800;
      }
      case "steam": this.puffs(at, o.radius ?? 3, t0, random, n(12), STEAM_RAMP, 7, 1700, 0.55); return 2200;
      case "smoke": this.puffs(at, o.radius ?? 3, t0, random, n(10), SMOKE_RAMP, 3.5, 3000, 0.6); return 3400;
      case "poof": this.puffs(at, o.radius ?? 2, t0, random, n(7), DUST_RAMP, 2.5, 900, 0.4); return 1000;
      case "dust": this.puffs(at, o.radius ?? 4, t0, random, n(14), DUST_RAMP, 1.6, 3200, 0.5); return 3600;
      case "sparks": this.sparksAt(at, t0, random, n(14), color ? [C("#ffffff"), color, mix(color, C("#000000"), 0.5)] : SPARK_RAMP); return 700;
      case "embers": {
        for (let i = 0; i < n(10); i++) this.particles.push(this.p(t0 + random() * 400, 900 + random() * 900, jitter(at, o.radius ?? 2, random), { vx: (random() - 0.5) * 3, vy: (random() - 0.5) * 2, rise: 5 + random() * 5, wind: 0.8, glyphs: "*'·.", colors: EMBER_RAMP, glow: true, layer: 2 }));
        return 1800;
      }
      case "ignite": {
        this.sparksAt(at, t0, random, n(10), SPARK_RAMP);
        this.lights.push({ born: t0, life: 500, at, radius: (o.radius ?? 4) * 3, color: C(FLAME_LIGHT[flame]), intensity: 1.2, curve: "flash" });
        this.puffs(at, o.radius ?? 2, t0 + 150, random, n(4), SMOKE_RAMP, 4, 1500, 0.5);
        return 1600;
      }
      case "shockwave": {
        const radius = o.radius ?? 15;
        this.areas.push({ born: t0, life: 520, kind: "ring", at, r0: 1, r1: radius, width: 2.6, color: color ?? C("#ffffff"), flame, strength: 1, seed: Math.floor(random() * 1e6) });
        return 520;
      }
      case "flash": {
        const radius = o.radius ?? 12;
        this.lights.push({ born: t0, life: 420, at, radius: radius * 2, color: color ?? C("#fff4d0"), intensity: 1.8, curve: "flash" });
        this.areas.push({ born: t0, life: 160, kind: "flash", at, r0: radius, r1: radius, width: 0, color: color ?? C("#ffffff"), flame, strength: 0.85, seed: 0 });
        return 420;
      }
      case "debris": {
        for (let i = 0; i < n(14); i++) {
          const a = random() * Math.PI * 2, sp = (o.radius ?? 4) * (0.6 + random());
          this.particles.push(this.p(t0, 600 + random() * 500, at, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 5 + random() * 8, drag: 2, gravity: 36, glyphs: "%,.", colors: color ? [color, mix(color, C("#000000"), 0.5)] : DEBRIS_RAMP, layer: 1 }));
        }
        this.puffs(at, 2, t0 + 80, random, n(5), DUST_RAMP, 2, 1100, 0.45);
        return 1200;
      }
      case "throw": {
        const to = o.to ?? at;
        const from = o.from ?? at;
        const travel = this.projectile(from, to, t0, random, { glyph: o.glyph ?? "•", colors: [color ?? C("#c8c0b0")], speed: 55, arc: 6, glow: false });
        return travel;
      }
    }
    return 0;
  }

  /** A fireball's (or an explosion's) burst: flash, shockwave, a sphere of flame, embers, then smoke. */
  private burst(at: Anchor, radius: number, t0: number, random: () => number, flame: FlameName, amount: number, big = false): void {
    const n = (k: number) => Math.max(1, Math.round(k * amount));
    const seed = Math.floor(random() * 1e6);
    this.areas.push({ born: t0, life: 150, kind: "flash", at, r0: radius * 1.4, r1: radius * 1.4, width: 0, color: C("#fff8e0"), flame, strength: big ? 0.95 : 0.8, seed });
    this.areas.push({ born: t0, life: big ? 620 : 520, kind: "ring", at, r0: 1, r1: radius * (big ? 1.6 : 1.3), width: big ? 3.2 : 2.6, color: C("#fff4d0"), flame, strength: 1, seed: seed + 1 });
    this.areas.push({ born: t0 + 30, life: big ? 1400 : 1100, kind: "fire", at, r0: 0, r1: radius, width: 0, color: C(FLAME_LIGHT[flame]), flame, strength: 1, seed: seed + 2 });
    this.lights.push({ born: t0, life: big ? 1700 : 1300, at, radius: radius * 2.6, color: C(flame === "fire" ? "#ffcc80" : FLAME_LIGHT[flame]), intensity: big ? 2.6 : 2.1, curve: "flash" });
    for (let i = 0; i < n(big ? 56 : 40); i++) {
      const a = random() * Math.PI * 2, sp = radius * (0.5 + random() * 1.4);
      this.particles.push(this.p(t0 + random() * 120, 700 + random() * 1100, at, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.9, vz: 2 + random() * 6, drag: 2.2, rise: 3 + random() * 4, wind: 0.6, glyphs: "*'·.", colors: flame === "fire" ? EMBER_RAMP : [C("#ffffff"), ...FLAME_RAMPS[flame].slice(2).reverse()], glow: true, layer: 2 }));
    }
    this.puffs(at, radius * 0.8, t0 + 350, random, n(big ? 26 : 18), SMOKE_RAMP, 4, big ? 3600 : 2800, 0.6);
    this.shakes.push({ born: t0, life: 300, amount: big ? 2 : 1 });
  }

  private sparksAt(at: Anchor, t0: number, random: () => number, count: number, colors: RGB[]): void {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, sp = 6 + random() * 14;
      this.particles.push(this.p(t0 + random() * 40, 250 + random() * 350, at, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 2 + random() * 6, drag: 3, gravity: 18, glyphs: "*'·", colors, glow: true, layer: 1 }));
    }
  }

  private puffs(at: Anchor, radius: number, t0: number, random: () => number, count: number, colors: RGB[], rise: number, life: number, alpha: number): void {
    for (let i = 0; i < count; i++) {
      // A puff: thick at first, thinning to a wisp; translucent, so what's under it shows through.
      this.particles.push(this.p(t0 + random() * life * 0.35, life * (0.6 + random() * 0.6), jitter(at, radius, random), {
        vx: (random() - 0.5) * 3, vy: (random() - 0.5) * 2, rise: rise * (0.6 + random() * 0.8), wind: 1, glyphs: random() < 0.5 ? "░░··" : "▒░░·", colors, bg: colors, bgAlpha: alpha * 0.6, layer: 2, glow: false,
      }));
    }
  }

  /** Something flying from a to b (a bolt's head, a thrown stone): its trail follows it. Returns the flight time. */
  private projectile(from: Anchor, to: Anchor, t0: number, random: () => number, o: { glyph: string; colors: RGB[]; trail?: readonly RGB[]; speed: number; arc: number; glow: boolean }): number {
    const a = isId(from) ? undefined : from, b = isId(to) ? undefined : to;
    const dist = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 30;
    const travel = Math.max(140, Math.min(900, (dist / o.speed) * 1000));
    this.particles.push({ ...this.p(t0, travel, from, { glyphs: o.glyph, colors: o.colors, glow: o.glow, layer: 1 }), path: { from, to, arc: o.arc }, z: 2, fade: false });
    if (o.glow && o.trail) {
      // A comet's head: a dimmer cell either side of the bright one, so it reads at speed.
      for (const side of [-1.1, 1.1]) this.particles.push({ ...this.p(t0, travel, from, { glyphs: "▒", colors: [o.trail[o.trail.length > 2 ? 2 : 0]!], glow: true, layer: 1 }), path: { from, to, arc: o.arc, side }, z: 2, fade: false });
    }
    if (o.trail) {
      // The trail: sparks dropped along the way, each living a moment where it was left.
      const steps = Math.max(4, Math.round(dist / 2.5));
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        const p = a && b ? { x: a.x + (b.x - a.x) * f + (random() - 0.5), y: a.y + (b.y - a.y) * f + (random() - 0.5) } : to;
        this.particles.push(this.p(t0 + travel * f, 180 + random() * 200, p as Anchor, { z: 2 + o.arc * 4 * f * (1 - f), rise: 2, wind: 0.3, glyphs: "*'·", colors: [...o.trail], glow: true, layer: 1 }));
      }
    }
    return travel;
  }

  private p(born: number, life: number, at: Anchor, o: Partial<Particle> & { glyphs: string; colors: RGB[] }): Particle {
    const pos = isId(at) ? { x: 0, y: 0 } : at;
    return {
      born, life, x: pos.x, y: pos.y, z: o.z ?? 1, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, drag: o.drag ?? 0, gravity: o.gravity ?? 0, rise: o.rise ?? 0, wind: o.wind ?? 0,
      glyphs: o.glyphs, colors: o.colors, ...(o.bg ? { bg: o.bg } : {}), ...(o.bgAlpha !== undefined ? { bgAlpha: o.bgAlpha } : {}),
      glow: o.glow ?? false, layer: o.layer ?? 1, fade: o.fade ?? true, ...(isId(at) ? { anchor: at } : {}),
    };
  }
}

function jitter(at: Anchor, radius: number, random: () => number): Anchor {
  if (isId(at)) return at;
  const a = random() * Math.PI * 2, r = radius * Math.sqrt(random());
  return { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
}

/**
 * How an area effect looks at a point (feet from its centre): a shockwave ring, a sphere of fire,
 * a white flash. Returns undefined where it doesn't touch. The renderer calls this per cell.
 */
export function areaCell(area: Area, px: number, py: number, t: number): { glyph?: string; fg: RGB; bg?: RGB; mixBg: number; mixFg: number; glow: boolean } | undefined {
  const d = Math.hypot(px - area.x, py - area.y);
  switch (area.kind) {
    case "ring": {
      const off = Math.abs(d - area.radius);
      if (off > area.width / 2 + 0.6) return undefined;
      const k = clamp01(1 - off / (area.width / 2 + 0.6)) * area.strength * (1 - area.t01 * 0.85);
      if (k < 0.08) return undefined;
      if (area.flame === "ember") {
        // A ripple on water (a splash): a thin bright line, no glow.
        const fg = mix(area.color, C("#ffffff"), 0.3 * (1 - area.t01));
        return { glyph: k > 0.55 ? "~" : k > 0.3 ? "°" : "·", fg, mixBg: 0, mixFg: k, glow: false };
      }
      // A shockwave: the air itself, white-hot to dull as it spreads.
      const fg = area.color === C("#ffffff") || area.color === C("#fff4d0") ? ramp(RING_RAMP, area.t01) : mix(area.color, C("#3a3038"), area.t01 * 0.8);
      return { glyph: k > 0.7 ? "▓" : k > 0.45 ? "▒" : k > 0.25 ? "░" : "·", fg, bg: mix(fg, C("#000000"), 0.4), mixBg: k * 0.75, mixFg: k, glow: true };
    }
    case "fire": {
      if (d > area.radius) return undefined;
      // A sphere of fire: white-hot at the heart, banded orange and red outward, the rim ragged and
      // flickering. It burns out from the edge in, the heat rolling upward as it goes.
      const e = d / Math.max(1, area.radius);
      const life = 1 - area.t01;
      const churn = noise3(px * 0.22, py * 0.16 + t / 160, t / 260, area.seed);
      const heat = clamp01((1 - e ** 1.6) * 1.05 + (churn - 0.5) * 0.55) * (life ** 0.55);
      if (heat < 0.14 + (1 - life) * 0.2) return undefined;
      const fl = FLAME_RAMPS[area.flame];
      const glyph = heat > 0.82 ? "█" : heat > 0.66 ? "▓" : heat > 0.5 ? "▒" : heat > 0.36 ? (churn > 0.55 ? "▲" : "^") : churn > 0.5 ? "'" : "·";
      return { glyph, fg: ramp(fl, clamp01(0.3 + heat * 0.75)), bg: ramp(fl, clamp01(0.06 + heat * 0.55)), mixBg: clamp01(0.25 + heat * 1.2), mixFg: 1, glow: true };
    }
    case "flash": {
      if (d > area.radius) return undefined;
      const k = area.strength * (1 - area.t01) * (1 - 0.4 * d / Math.max(1, area.radius));
      return { fg: area.color, bg: area.color, mixBg: k, mixFg: k, glow: true };
    }
  }
}
