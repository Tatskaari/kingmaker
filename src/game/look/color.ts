/**
 * Colour for the look layer. Inside, colours are packed 0xRRGGBB numbers (a frame does a lot of
 * mixing and lighting, and strings are slow to build); at the edges they're "#rrggbb" strings, which
 * is what the StyledLine contract (src/game/types.ts) and OpenTUI take.
 *
 * The named palette is Caves of Qud's discipline in truecolor: base looks pick from a small set of
 * named colours (the model chooses names, not hex), and light, fire and water make the in-between
 * shades, the way Qud's tiles mix their primary and detail colours.
 */

export type RGB = number;

const HEX2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const parsed = new Map<string, RGB>();

/** "#rrggbb" (or "#rgb") to a packed colour; cached, since the same few dozen strings recur. */
export function rgbOf(hex: string): RGB {
  let v = parsed.get(hex);
  if (v === undefined) {
    const h = hex.startsWith("#") ? hex.slice(1) : hex;
    v = h.length === 3 ? parseInt(h[0]! + h[0] + h[1] + h[1] + h[2] + h[2], 16) : parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(v)) v = 0;
    parsed.set(hex, v);
  }
  return v;
}

export const hexOf = (c: RGB): string => `#${HEX2[(c >> 16) & 255]}${HEX2[(c >> 8) & 255]}${HEX2[c & 255]}`;

const byte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
export const pack = (r: number, g: number, b: number): RGB => (byte(r) << 16) | (byte(g) << 8) | byte(b);
export const red = (c: RGB) => (c >> 16) & 255;
export const green = (c: RGB) => (c >> 8) & 255;
export const blue = (c: RGB) => c & 255;

export function mix(a: RGB, b: RGB, t: number): RGB {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  return pack(ar + (((b >> 16) & 255) - ar) * t, ag + (((b >> 8) & 255) - ag) * t, ab + ((b & 255) - ab) * t);
}

export const scale = (c: RGB, k: number): RGB => pack(((c >> 16) & 255) * k, ((c >> 8) & 255) * k, (c & 255) * k);

/** Light falling on a colour: each channel times the light's channel (1 = as authored). */
export const multiply = (c: RGB, lr: number, lg: number, lb: number): RGB => pack(((c >> 16) & 255) * lr, ((c >> 8) & 255) * lg, (c & 255) * lb);

/** Perceived brightness, 0..1. */
export const luminance = (c: RGB) => (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;

export function desaturate(c: RGB, k: number): RGB {
  const l = luminance(c) * 255;
  return mix(c, pack(l, l, l), k);
}

/** A colour along a ramp of stops, t in 0..1. */
export function ramp(stops: readonly RGB[], t: number): RGB {
  if (stops.length === 1 || t <= 0) return stops[0]!;
  if (t >= 1) return stops[stops.length - 1]!;
  const f = t * (stops.length - 1);
  const i = Math.floor(f);
  return mix(stops[i]!, stops[i + 1]!, f - i);
}

/** Additive blend (light, glow), clamped. */
export const add = (a: RGB, b: RGB, k = 1): RGB => pack(red(a) + red(b) * k, green(a) + green(b) * k, blue(a) + blue(b) * k);

/** Convenience for the string edge. */
export const hexMix = (a: string, b: string, t: number) => hexOf(mix(rgbOf(a), rgbOf(b), t));
export const hexScale = (a: string, k: number) => hexOf(scale(rgbOf(a), k));

// ---------------------------------------------------------------------------------------------
// The palette.

/**
 * Caves of Qud's eighteen colours, by their colour codes (Modding:Colors & Object Rendering on the
 * Qud wiki). k is the famous viridian background. Kept for reference and for Qud-style colour codes.
 */
export const QUD = {
  k: "#0f3b3a", K: "#155352", r: "#a64a2e", R: "#d74200", o: "#f15f22", O: "#e99f10", w: "#98875f", W: "#cfc041",
  g: "#009403", G: "#00c420", b: "#0048bd", B: "#0096ff", c: "#40a4b9", C: "#77bfcf", m: "#b154cf", M: "#da5bd6",
  y: "#b1c9c3", Y: "#ffffff",
} as const;

/**
 * Named colours for base looks: what a thing is made of and what it means. Tuned to read on the
 * dark grounds (nothing here is darker than the floor it lies on, except soot and tar).
 */
export const PALETTE = {
  // Reds and fire
  crimson: "#b8323a", scarlet: "#e0442a", rust: "#a65a32", ember: "#ff6a1a", orange: "#f08a2a", amber: "#e8a83a",
  // Yellows and golds
  gold: "#ffd75f", straw: "#d8c070", parchment: "#e2d6b0", cream: "#f0e4c4", tan: "#c8a878",
  // Browns (wood, leather)
  oak: "#a0703a", walnut: "#7a5232", tar: "#3c342c", leather: "#8a5a32", sacking: "#b89868",
  // Greens
  leaf: "#5a9a3a", moss: "#6a8a3a", grass: "#7ab84a", olive: "#8a8a4a", poison: "#8fdc3a", sage: "#a9c29a",
  // Blues and cyans
  teal: "#3aa0a0", cyan: "#7fd0e0", sky: "#9fc8f0", azure: "#3a8ae0", navy: "#2a4a8a", ice: "#cfefff", water: "#4a8ab8",
  // Purples and pinks
  violet: "#9a6ae0", purple: "#8a3aa0", royal: "#7a3aa8", magenta: "#d05ad0", pink: "#e8a0b8", lilac: "#b0a0d0",
  // Neutrals and metals
  white: "#f4f1e8", bone: "#e4dcc0", silver: "#c8ccd4", pewter: "#a8acb4", grey: "#9a968e", slate: "#7a8090",
  iron: "#7d8794", steel: "#a8b4c0", brass: "#c9a24a", copper: "#d08850", stone: "#8a8580", charcoal: "#3a3430",
  soot: "#2a2420", black: "#24222a", flesh: "#d8a07a", glass: "#9fd0d8",
} as const;

export type ColorName = keyof typeof PALETTE;
export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[];

/** A named colour, a hex string, or undefined: always a hex string out. */
export function colorOf(c: string | undefined, fallback = PALETTE.grey): string {
  if (!c) return fallback;
  if (c.startsWith("#")) return c;
  return (PALETTE as Record<string, string>)[c] ?? fallback;
}

/** Material colours: the colour a thing is when nothing more specific says otherwise. */
export const MATERIAL_COLOR: Record<string, string> = {
  cloth: "#b8a888", paper: PALETTE.parchment, rope: "#c8a878", glass: PALETTE.glass, ice: PALETTE.ice, crystal: "#c8f0ff",
  wood: PALETTE.oak, bone: PALETTE.bone, leather: PALETTE.leather, stone: PALETTE.stone, iron: PALETTE.iron, steel: PALETTE.steel,
  brass: PALETTE.brass, silver: PALETTE.silver, flesh: PALETTE.flesh, liquid: PALETTE.water, gold: PALETTE.gold,
};

/** Flame ramps, coolest to hottest: the colour of fire tells you what's burning. */
export const FLAMES = {
  fire: ["#2a0600", "#6a1200", "#b82800", "#e85000", "#ff8a00", "#ffbe20", "#ffe680", "#fff8e0"],
  // Driftwood burns blue with the salt in it.
  blue: ["#020a24", "#06205a", "#0c3c9a", "#1a64d8", "#3a94ff", "#7cc4ff", "#c4ecff", "#f4fcff"],
  green: ["#021a04", "#06400c", "#0c7018", "#20a82a", "#52d83a", "#9cf06a", "#d8ffb0", "#f4fff0"],
  violet: ["#140420", "#340a5a", "#5a1a9a", "#8a3ad8", "#b46aff", "#d4a0ff", "#ecd4ff", "#fbf4ff"],
  ember: ["#1a0400", "#3a0a00", "#6a1400", "#9a2400", "#c83a10", "#e85a20", "#ff8a40", "#ffb070"],
} as const;
export type FlameName = keyof typeof FLAMES;
export const FLAME_RAMPS: Record<FlameName, RGB[]> = Object.fromEntries(Object.entries(FLAMES).map(([k, v]) => [k, v.map(rgbOf)])) as Record<FlameName, RGB[]>;

/** The light a flame casts, by palette. */
export const FLAME_LIGHT: Record<FlameName, string> = { fire: "#ff9a3c", blue: "#4a9cff", green: "#6ad84a", violet: "#b07aff", ember: "#ff6a2a" };

/** Damage numbers are coloured by what did the damage (Cogmind and Brogue: colour carries the kind). */
export const DAMAGE_COLOR: Record<string, string> = {
  fire: "#ff8a2a", cold: "#8fe0ff", lightning: "#f8f4a0", thunder: "#a0a8ff", acid: "#b0f040", poison: "#8fdc3a",
  necrotic: "#9a7ab0", radiant: "#ffe680", psychic: "#f08ad0", force: "#d07aff",
  bludgeoning: "#ff5a4a", piercing: "#ff5a4a", slashing: "#ff5a4a", heal: "#6ae07a",
};
