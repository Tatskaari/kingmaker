// Copied from the prototype's src/game/look/light.ts at 44c6d4a, whole, unchanged.
import { contrast, mix, pack, rgbOf, type RGB } from "./color.ts";
import type { TimeOfDay } from "./appearance.ts";

/**
 * Light, Brogue-style: every cell has a light colour (three multipliers); a cell's colours are
 * multiplied by it. The ambient light depends on the time of day and on whether the cell is
 * indoors; lamps, fires and burning things add coloured light that falls off softly and is
 * stopped by walls. Things that glow (flames, lamps, sparks) aren't darkened by the dark. Glints
 * on water and wet stone take the colour of the light that falls on them, so the river by the
 * Rat's door is blue with moonlight and orange by the fire.
 */

export interface Ambient { level: number; tint: string }

/** Daylight by the time of day: outdoors, and indoors (where it comes through doors and windows). */
export const DAYLIGHT: Record<TimeOfDay, { outdoor: Ambient; indoor: Ambient }> = {
  morning: { outdoor: { level: 0.96, tint: "#ffe8c4" }, indoor: { level: 0.56, tint: "#f0dcc0" } },
  afternoon: { outdoor: { level: 1.04, tint: "#ffffff" }, indoor: { level: 0.62, tint: "#f4ece0" } },
  evening: { outdoor: { level: 0.7, tint: "#e8b8b0" }, indoor: { level: 0.32, tint: "#c0a098" } },
  night: { outdoor: { level: 0.3, tint: "#5a74c0" }, indoor: { level: 0.11, tint: "#4a5a90" } },
  "next-morning": { outdoor: { level: 0.98, tint: "#eef4ff" }, indoor: { level: 0.6, tint: "#e8eef8" } },
};

export const ambientOf = (time: TimeOfDay, indoor: boolean): Ambient => DAYLIGHT[time][indoor ? "indoor" : "outdoor"];

export interface LightSource {
  /** Cell coordinates (fractional is fine). */
  x: number;
  y: number;
  /** In columns; rows count double (cells are twice as tall as wide). */
  radius: number;
  color: RGB;
  intensity: number;
}

/** A field of light over a grid of cells. Build it once per frame: reset, add lights, read. */
export class LightField {
  readonly w: number;
  readonly h: number;
  /** Total light (ambient + sources), per channel. */
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Light from sources only (glints and warmth use it). */
  readonly dr: Float32Array;
  readonly dg: Float32Array;
  readonly db: Float32Array;
  private opaque: Uint8Array | undefined;
  private masks = new Map<string, Uint8Array>();
  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    const n = w * h;
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n);
    this.dr = new Float32Array(n); this.dg = new Float32Array(n); this.db = new Float32Array(n);
  }

  /** Cells that stop light (walls). Changing it forgets the cached shadow masks. */
  setOpaque(opaque: Uint8Array | undefined): void {
    if (opaque !== this.opaque) this.masks.clear();
    this.opaque = opaque;
  }

  /** Start a frame: every cell gets its ambient light. */
  reset(ambient: (i: number) => Ambient): void {
    let last: Ambient | undefined, ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < this.r.length; i++) {
      const a = ambient(i);
      if (a !== last) { const c = rgbOf(a.tint); ar = ((c >> 16) & 255) / 255 * a.level; ag = ((c >> 8) & 255) / 255 * a.level; ab = (c & 255) / 255 * a.level; last = a; }
      this.r[i] = ar; this.g[i] = ag; this.b[i] = ab;
      this.dr[i] = 0; this.dg[i] = 0; this.db[i] = 0;
    }
  }

  /** Add a light: soft falloff, a bright core, shadows behind walls. */
  add(light: LightSource): void {
    const R = Math.max(1, light.radius);
    const x0 = Math.max(0, Math.floor(light.x - R)), x1 = Math.min(this.w - 1, Math.ceil(light.x + R));
    const y0 = Math.max(0, Math.floor(light.y - R / 2)), y1 = Math.min(this.h - 1, Math.ceil(light.y + R / 2));
    const lr = ((light.color >> 16) & 255) / 255 * light.intensity, lg = ((light.color >> 8) & 255) / 255 * light.intensity, lb = (light.color & 255) / 255 * light.intensity;
    // The cell the light is in (positions are often cell centres, x.5: rounding would put a lamp
    // beside a wall inside it, and light only the far side).
    const sx = Math.floor(light.x), sy = Math.floor(light.y);
    const mask = this.opaque ? this.shadow(sx, sy, Math.ceil(R)) : undefined;
    const mw = Math.ceil(R) * 2 + 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const q2 = ((x + 0.5 - light.x) ** 2 + ((y + 0.5 - light.y) * 2) ** 2) / (R * R);
      if (q2 >= 1) continue;
      if (mask) {
        const mx = x - sx + Math.ceil(R), my = y - sy + Math.ceil(R);
        if (mx < 0 || my < 0 || mx >= mw || my >= mw || !mask[my * mw + mx]) continue;
      }
      const f = (1 - q2) * (1 - q2);
      const i = y * this.w + x;
      this.r[i]! += lr * f; this.g[i]! += lg * f; this.b[i]! += lb * f;
      this.dr[i]! += lr * f; this.dg[i]! += lg * f; this.db[i]! += lb * f;
    }
  }

  /** Which cells a light at (cx, cy) reaches past the walls (cached per position and reach). */
  private shadow(cx: number, cy: number, R: number): Uint8Array {
    const key = `${cx},${cy},${R}`;
    const hit = this.masks.get(key);
    if (hit) return hit;
    const mw = R * 2 + 1;
    const mask = new Uint8Array(mw * mw);
    const opaque = this.opaque!;
    for (let my = 0; my < mw; my++) for (let mx = 0; mx < mw; mx++) {
      const tx = cx + mx - R, ty = cy + my - R;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      // Walk the line from the light; a wall stops it (the wall itself is lit on its face).
      const steps = Math.max(Math.abs(tx - cx), Math.abs(ty - cy) * 2);
      let clear = true;
      for (let s = 1; s < steps; s++) {
        const px = Math.round(cx + ((tx - cx) * s) / steps), py = Math.round(cy + ((ty - cy) * s) / steps);
        if ((px !== tx || py !== ty) && opaque[py * this.w + px]) { clear = false; break; }
      }
      if (clear) mask[my * mw + mx] = 1;
    }
    if (this.masks.size > 400) this.masks.clear();
    this.masks.set(key, mask);
    return mask;
  }
}

/**
 * Shade a colour by the light at cell i. Bright light (more than daylight) pushes colours towards
 * the light's own colour a little, which is what makes a fire's glow look warm and not just bright.
 */
export function shade(color: RGB, field: LightField, i: number, floor = 0): RGB {
  return shadeBy(color, field.r[i]!, field.g[i]!, field.b[i]!, floor);
}

/** Shade a colour by a light (three multipliers), with a floor for things that should stay findable in the dark. */
export function shadeBy(color: RGB, lr: number, lg: number, lb: number, floor = 0): RGB {
  if (floor > 0) { const m = Math.max(lr, lg, lb); if (m < floor) { const k = floor / Math.max(0.001, m); lr *= k; lg *= k; lb *= k; } }
  const r = ((color >> 16) & 255) * lr, g = ((color >> 8) & 255) * lg, b = (color & 255) * lb;
  const over = Math.max(r, g, b) - 255;
  if (over > 0) {
    // Soft clip: spill the excess into the other channels (a white-hot core), not a flat ceiling.
    const k = Math.min(1, over / 255) * 0.5;
    return pack(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k);
  }
  return pack(r, g, b);
}

/** How readable someone stays in any light: 3.5 to 1 against what's behind them (findable, and still in the dark). */
export const BEING_CONTRAST = 3.5;

/**
 * Someone (a person, a dog) in the light. Lit by only half the light's colour, so they stay who
 * they are (Hobb by the blue fire is still orange, only cooler), never below `floor` of their own
 * colour, and never less than BEING_CONTRAST against the ground behind them (`bg`, already lit):
 * where the dark takes more than that, they come back towards their own colour, as far as it needs.
 */
export function shadeBeing(color: RGB, lr: number, lg: number, lb: number, floor: number, bg: RGB): RGB {
  const m = Math.max(lr, lg, lb);
  return legible(shadeBy(color, (lr + m) / 2, (lg + m) / 2, (lb + m) / 2, floor), bg, color);
}

/**
 * A colour moved just far enough to stand `min` to 1 against `bg`: towards `own` (who it is), and on
 * past it towards white (black, on a ground too bright for white) when even `own` won't do (Moll in
 * pink on a sunlit wall top).
 */
export function legible(fg: RGB, bg: RGB, own: RGB, min = BEING_CONTRAST): RGB {
  if (contrast(fg, bg) >= min) return fg;
  const toward = (from: RGB, to: RGB): RGB => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 7; i++) { const k = (lo + hi) / 2; if (contrast(mix(from, to, k), bg) >= min) hi = k; else lo = k; }
    return mix(from, to, hi);
  };
  if (contrast(own, bg) >= min) return toward(fg, own);
  const edge = contrast(WHITE, bg) >= min ? WHITE : 0;
  return contrast(edge, bg) > contrast(own, bg) ? toward(own, edge) : own;
}

const WHITE = 0xffffff;

/** A glint (water, wet stone) takes the colour of the strongest light on it. */
export function glint(color: RGB, field: LightField, i: number, specular: number): RGB {
  const dr = field.dr[i]!, dg = field.dg[i]!, db = field.db[i]!;
  const m = Math.max(dr, dg, db);
  if (m < 0.05 || specular <= 0) return color;
  const lightColor = pack((dr / m) * 255, (dg / m) * 255, (db / m) * 255);
  return mix(color, lightColor, Math.min(1, specular * Math.min(1, m * 1.4)));
}
