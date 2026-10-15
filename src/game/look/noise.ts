/**
 * Deterministic randomness for animation. Everything that moves on screen is a pure function of
 * (where, when, seed): a frame at time t looks the same however you got there, so headless dumps
 * and tests are exact, and nothing needs per-cell state. Value noise gives the smooth wobble (water,
 * wind, flame heat); hashes give the sparkle.
 */

/** A 32-bit hash of integers (FNV-ish with a final avalanche). */
export function hash(a: number, b = 0, c = 0, d = 0): number {
  let h = 2166136261 ^ Math.imul(a | 0, 374761393);
  h = Math.imul(h ^ (b | 0), 668265263);
  h = Math.imul(h ^ (c | 0), 2246822519);
  h = Math.imul(h ^ (d | 0), 3266489917);
  h ^= h >>> 15; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A hash as a number in [0, 1). */
export const hash01 = (a: number, b = 0, c = 0, d = 0) => hash(a, b, c, d) / 4294967296;

/** A stable seed for a string (an entity id, a name). */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth 1D value noise in [0, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x), f = x - i;
  return lerp(hash01(i, seed), hash01(i + 1, seed), fade(f));
}

/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const a = hash01(xi, yi, seed), b = hash01(xi + 1, yi, seed), c = hash01(xi, yi + 1, seed), d = hash01(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Smooth 3D value noise in [0, 1] (the third axis is usually time). */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const zi = Math.floor(z), fz = fade(z - zi);
  return lerp(noise2(x, y, seed + zi * 7919), noise2(x, y, seed + (zi + 1) * 7919), fz);
}

/** Fractal 2D noise: a few octaves of value noise, in [0, 1]. */
export function fbm2(x: number, y: number, seed = 0, octaves = 3): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * f, y * f, seed + o * 101);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

/** A seeded generator (mulberry32) for effects that spawn a handful of particles at once. */
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

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const pick = <T>(items: readonly T[], r: number): T => items[Math.min(items.length - 1, Math.floor(r * items.length))]!;

/**
 * A flame's heat at a moment: fast wobble on a slower swell, in [0, 1]. Each flame gets its own seed
 * so neighbours don't flicker in step (Qud gives every animated object a random frame offset).
 */
export function flicker(tMs: number, seed: number, speed = 1): number {
  const s = tMs / 1000 * speed;
  return 0.55 * noise1(s * 9, seed) + 0.3 * noise1(s * 3.1, seed + 17) + 0.15 * noise1(s * 23, seed + 31);
}
