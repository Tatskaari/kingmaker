import { FLAME_RAMPS, hexOf, mix, ramp, rgbOf, scale, type FlameName, type RGB } from "./color.ts";
import type { TimeOfDay } from "./appearance.ts";
import { inSet, type GlyphSet } from "./glyphs.ts";
import { clamp01, hash, hash01, noise2, noise3, smoothstep } from "./noise.ts";

/**
 * Living terrain: the ground, walls, the surfaces lying on the ground (water, oil, spirits, blood,
 * ash, char, ice...), clouds over everything (smoke, steam, dust), flames on a burning surface, and
 * drizzle. Every function here is a pure function of (cell, time), so a renderer calls it per cell
 * per frame and nothing has to remember anything.
 *
 * Cells are about twice as tall as they are wide, so patterns work in "square" units (x, 2y) and
 * nothing looks stretched. Flow (water) and wind (grass, smoke) are in those units per second.
 *
 * What moves and how (the Caves of Qud / Brogue rule: motion means life or danger):
 *   water: ripples carried by the current, a shifting bed of blues, glints that catch the light;
 *   puddles: the sky's colour, a slow shiver; oil: a thin-film rainbow sheen; spirits: a faint shimmer;
 *   blood: still, dark, a wet highlight; grass: gusts that travel across it, tips catching the light;
 *   flames: heat rising through the cells; smoke and steam: drifting, thinning; ash and char: still.
 */

export interface TCell {
  glyph: string;
  fg: RGB;
  bg: RGB;
  /** 0..1: a glint that should take the colour of the light falling on it (water, wet stone). */
  specular?: number;
  liquid?: boolean;
  /** Emissive (flames on a burning surface). */
  glow?: boolean;
}

export interface TerrainContext {
  /** Milliseconds. */
  t: number;
  time?: TimeOfDay;
  /** Water current, square units per second ({ x: 0, y: 1.5 } runs south). */
  flow?: { x: number; y: number };
  /** Wind: direction in radians (0 = east, PI/2 = south), strength 0..1. */
  wind?: { dir: number; strength: number };
  seed?: number;
  glyphs?: GlyphSet;
}

export type Ground = "cobbles" | "flags" | "boards" | "loft" | "dirt" | "mud" | "grass" | "straw" | "carpet" | "steps" | "sand" | "rubble" | "scorched" | "void"
  | "water" | "deep-water" | "river" | "puddle";
export type WallStyle = "stone" | "timber" | "bank" | "brick" | "plaster" | "palace" | "hedge";
export type SurfaceKind = "water" | "oil" | "spirits" | "blood" | "ale" | "wine" | "slops" | "milk" | "honey" | "ink" | "mud" | "ash" | "char" | "ice" | "snow"
  | "dust" | "grain" | "straw" | "acid" | "slime" | "vomit" | "tar" | "grease" | "scorch";
export type CloudKind = "smoke" | "steam" | "dust" | "fog" | "poison";

const c = rgbOf;
const WHITE = c("#ffffff");

/** The sky's colour in still water, by the time of day. */
const SKY: Record<TimeOfDay, RGB> = { morning: c("#6a88a8"), afternoon: c("#5a84b0"), evening: c("#7a4a68"), night: c("#1c2842"), "next-morning": c("#7a98b8") };
/** The glint on water: the sun's colour, or the moon's. */
const GLINT: Record<TimeOfDay, RGB> = { morning: c("#fff0c0"), afternoon: c("#ffffff"), evening: c("#ffb070"), night: c("#c0d0ff"), "next-morning": c("#f0f8ff") };

const sq = (cy: number) => cy * 2;

// ---------------------------------------------------------------------------------------------
// Ground.

export function groundCell(kind: Ground, cx: number, cy: number, ctx: TerrainContext): TCell {
  const set = ctx.glyphs ?? "ascii";
  const g = (ch: string) => (set === "plain" ? inSet(ch, "plain") : ch);
  const s = ctx.seed ?? 0;
  switch (kind) {
    case "cobbles": {
      // Staggered two-cell cobbles, each its own shade; the odd speck of grit between them.
      const stone = Math.floor((cx + (cy & 1)) / 2);
      const v = hash01(stone, cy, s + 3);
      // Broad patches (damp, worn, mossy) under the stone-by-stone variety.
      const patch = noise2(cx * 0.08, cy * 0.16, s + 4);
      const bg = mix(scale(c("#2e2b2c"), 0.84 + 0.3 * v), c("#2a2c26"), patch * 0.5);
      const r = hash01(cx, cy, s + 5);
      const edge = (cx + (cy & 1)) % 2 === 0;
      const glyph = r < 0.1 ? "∙" : r < 0.2 ? "·" : r < 0.24 ? "," : edge && r < 0.5 ? "·" : " ";
      return { glyph: g(glyph), fg: scale(c("#56504e"), 0.9 + 0.2 * v), bg };
    }
    case "flags": {
      // Flagstones: courses a row tall, slabs three to six cells long, each its own grey, the
      // joints a shade darker (shade, not lines: lines make a floor busy).
      const off = hash(cy, s + 1) % 6;
      const len = 3 + (hash(cy, s + 2) % 4);
      const slab = Math.floor((cx + off) / len);
      const joint = (cx + off) % len === 0;
      const v = hash01(slab, cy, s + 7);
      const base = scale(c("#36322e"), 0.84 + 0.3 * v);
      const bg = joint ? scale(base, 0.72) : base;
      const r = hash01(cx, cy, s + 9);
      return { glyph: g(r < 0.04 ? "∙" : r < 0.07 ? "·" : " "), fg: scale(base, 1.45), bg };
    }
    case "boards":
    case "loft": {
      // Planks along the rows: each run of cells one plank, its own shade, a little grain, darker
      // butt ends. The loft's are older, paler and dusty.
      const off = hash(cy, s + 4) % 13;
      const len = 8 + (hash(cy, s + 6) % 7);
      const plank = Math.floor((cx + off) / len);
      const end = (cx + off) % len === 0;
      const v = hash01(plank, cy, s + 8);
      const base = scale(kind === "loft" ? c("#4a3826") : c("#3e2a1a"), (0.88 + 0.18 * v) * (0.96 + 0.08 * hash01(cx, cy, s + 11)));
      const bg = end ? scale(base, 0.66) : (cy & 1) ? scale(base, 0.94) : base;
      const r = hash01(cx, cy, s + 10);
      if (kind === "loft" && r < 0.08) return { glyph: g(r < 0.03 ? "∙" : "·"), fg: c("#b8a478"), bg };
      return { glyph: g(!end && r < 0.14 ? "─" : !end && r < 0.17 ? "°" : " "), fg: scale(base, 1.35), bg };
    }
    case "dirt": {
      const v = noise2(cx * 0.3, sq(cy) * 0.3, s + 11);
      const r = hash01(cx, cy, s + 12);
      return { glyph: g(r < 0.08 ? "." : r < 0.14 ? "," : r < 0.18 ? "·" : r < 0.2 ? "'" : " "), fg: c("#4e4234"), bg: mix(c("#29231b"), c("#33291e"), v) };
    }
    case "mud": {
      const v = noise2(cx * 0.25, sq(cy) * 0.25, s + 13);
      const r = hash01(cx, cy, s + 14);
      const glint = r > 0.97 ? 0.6 : 0;
      return { glyph: g(r < 0.1 ? "," : r < 0.16 ? "." : glint ? "·" : " "), fg: glint ? c("#6a5a48") : c("#3e3020"), bg: mix(c("#211810"), c("#2c2016"), v), specular: glint };
    }
    case "straw": {
      // Strewn straw: a gold-brown bed, a few stalks catching the light.
      const r = hash01(cx, cy, s + 15);
      const v = noise2(cx * 0.3, cy * 0.6, s + 17);
      return { glyph: g(r < 0.12 ? "\"" : r < 0.24 ? "'" : r < 0.3 ? "," : " "), fg: mix(c("#8a7a3a"), c("#c8b058"), hash01(cx, cy, s + 16)), bg: mix(c("#3a2e18"), c("#4a3c1e"), v) };
    }
    case "carpet": {
      const border = (cx + cy) % 2 === 0;
      return { glyph: g(border ? "░" : " "), fg: c("#6a2a36"), bg: c("#4a1a24") };
    }
    case "steps": {
      // A step a row: the tread's worn top half catches the light, the riser below is in shadow.
      // Wet steps (these always are) glint where the water lies.
      const r = hash01(cx, cy, s + 17);
      const wear = noise2(cx * 0.2, cy * 0.5, s + 19);
      const glint = noise3(cx * 0.4, sq(cy) * 0.2, ctx.t / 1500, s + 18) > 0.76 ? 0.8 : 0;
      const tread = scale(c("#4c4a54"), 0.86 + 0.28 * wear), riser = c("#22212a");
      if (glint) return { glyph: g("▀"), fg: mix(tread, c("#a8b4c8"), 0.6), bg: riser, specular: glint };
      return { glyph: g(r < 0.06 ? "▀" : "▀"), fg: r < 0.08 ? mix(tread, c("#3e5a34"), 0.6) : tread, bg: riser };
    }
    case "sand": {
      const r = hash01(cx, cy, s + 19);
      return { glyph: g(r < 0.12 ? "·" : r < 0.18 ? "∙" : " "), fg: c("#a89468"), bg: c("#5a4e34") };
    }
    case "rubble": {
      const r = hash01(cx, cy, s + 20);
      return { glyph: g(r < 0.25 ? "," : r < 0.42 ? "∙" : r < 0.55 ? "." : r < 0.62 ? "•" : " "), fg: scale(c("#6e6860"), 0.8 + 0.4 * hash01(cx, cy, s + 21)), bg: c("#26231f") };
    }
    case "scorched": {
      const r = hash01(cx, cy, s + 22);
      const ember = r > 0.985 && noise2(cx, ctx.t / 600, s + 23) > 0.6;
      return { glyph: g(ember ? "·" : r < 0.2 ? "," : r < 0.32 ? "∙" : " "), fg: ember ? c("#e05a1a") : c("#3a2c22"), bg: scale(c("#171210"), 0.85 + 0.3 * r), ...(ember ? { glow: true } : {}) };
    }
    case "grass": return grass(cx, cy, ctx, g);
    case "water":
    case "deep-water":
    case "river": return water(kind, cx, cy, ctx, g);
    case "puddle": return puddleOver(groundCell("cobbles", cx, cy, ctx), cx, cy, 1, ctx);
    case "void":
    default: return { glyph: " ", fg: c("#0b0a0e"), bg: c("#0b0a0e") };
  }
}

/** Grass in a breeze: gusts travel across it downwind, bending the blades and lighting their tips. */
function grass(cx: number, cy: number, ctx: TerrainContext, g: (ch: string) => string): TCell {
  const s = ctx.seed ?? 0;
  const T = ctx.t / 1000;
  const w = ctx.wind ?? { dir: 0.4, strength: 0.5 };
  const X = cx, Y = sq(cy);
  const along = X * Math.cos(w.dir) + Y * Math.sin(w.dir), across = -X * Math.sin(w.dir) + Y * Math.cos(w.dir);
  const gust = noise2(along * 0.09 - T * (0.6 + 1.4 * w.strength), across * 0.16, s + 31);
  const sway = smoothstep(0.52, 0.85, gust) * (0.4 + 0.6 * w.strength);
  const r = hash01(cx, cy, s + 32);
  let glyph = r < 0.3 ? "\"" : r < 0.52 ? "'" : r < 0.64 ? "," : r < 0.72 ? "." : " ";
  if (sway > 0.35) glyph = glyph === "\"" ? "'" : glyph === "'" ? "`" : glyph;
  const base = mix(c("#2c5222"), c("#4e7e30"), hash01(cx, cy, s + 33));
  return { glyph: g(glyph), fg: mix(base, c("#a8cc70"), sway * 0.65), bg: mix(c("#142410"), c("#1a2e12"), noise2(cx * 0.2, Y * 0.2, s + 34)) };
}

const WATER_PALETTE = {
  water: { bg0: c("#0f2c4a"), bg1: c("#1a4466"), fg0: c("#2e6ea4"), fg1: c("#a0d8ff") },
  river: { bg0: c("#0a1d33"), bg1: c("#15385a"), fg0: c("#2a6098"), fg1: c("#9ad0f8") },
  "deep-water": { bg0: c("#061223"), bg1: c("#0d2642"), fg0: c("#1e4c7c"), fg1: c("#7ab4e8") },
};

/** Moving water: ripples carried by the current, a bed of blues that shifts, glints on the crests. */
function water(kind: "water" | "deep-water" | "river", cx: number, cy: number, ctx: TerrainContext, g: (ch: string) => string): TCell {
  const s = ctx.seed ?? 0;
  const T = ctx.t / 1000;
  const f = ctx.flow ?? (kind === "river" ? { x: 0.4, y: 1.6 } : { x: 0.25, y: 0.15 });
  const sp = Math.hypot(f.x, f.y) || 1e-6;
  const ux = f.x / sp, uy = f.y / sp;
  const X = cx, Y = sq(cy);
  const along = X * ux + Y * uy - sp * T, across = -X * uy + Y * ux;
  const n1 = noise2(along * 0.3, across * 0.8, s + 41);
  const n2 = noise2(along * 0.85 + 17.3, across * 1.5 - T * 0.4, s + 42);
  const h = 0.62 * n1 + 0.38 * n2;
  const p = WATER_PALETTE[kind];
  const bg = mix(p.bg0, p.bg1, n1 * 0.9);
  let glyph = " ", fg = p.fg0, specular = 0;
  if (h > 0.72) { glyph = "≈"; fg = mix(p.fg0, p.fg1, smoothstep(0.72, 0.92, h)); specular = 0.3; }
  else if (h > 0.59) { glyph = "~"; fg = mix(p.fg0, p.fg1, 0.35 * smoothstep(0.59, 0.72, h)); }
  if (h > 0.76 && hash01(cx, cy, Math.floor(T * 7), s + 43) < 0.2) { glyph = "∙"; fg = GLINT[ctx.time ?? "afternoon"]; specular = 1; }
  return { glyph: g(glyph), fg, bg, specular, liquid: true };
}

// ---------------------------------------------------------------------------------------------
// Walls.

export function wallCell(style: WallStyle, cx: number, cy: number, ctx: TerrainContext): TCell {
  const set = ctx.glyphs ?? "ascii";
  const g = (ch: string) => (set === "plain" ? inSet(ch, "plain") : ch);
  const r = hash01(cx, cy, 51);
  switch (style) {
    case "timber": {
      const stud = (cx + Math.floor(cy / 3)) % 4 === 0;
      return { glyph: g(stud ? "║" : r < 0.5 ? "▓" : "█"), fg: stud ? c("#7a5838") : scale(c("#4a3424"), 0.9 + 0.2 * r), bg: c("#2e2014") };
    }
    case "bank": return { glyph: g(r < 0.12 ? "\"" : r < 0.55 ? "▒" : "▓"), fg: r < 0.12 ? c("#4a6a2c") : scale(c("#4e4632"), 0.9 + 0.2 * hash01(cx, cy, 54)), bg: c("#2a2618") };
    case "brick": {
      const course = (cx + ((cy & 1) ? 2 : 0)) % 4 === 0;
      return { glyph: g(course ? "▌" : "▬"), fg: c("#8a4a36"), bg: c("#5a2e24") };
    }
    case "plaster": {
      const beam = cx % 5 === 0;
      return { glyph: g(beam ? "║" : r < 0.1 ? "░" : " "), fg: beam ? c("#4a3220") : c("#a8987a"), bg: c("#8a7e66") };
    }
    case "palace": {
      const gilt = cy % 3 === 0 && cx % 6 === 0;
      return { glyph: g(gilt ? "╬" : r < 0.4 ? "░" : " "), fg: gilt ? c("#c9a94a") : c("#a8a090"), bg: c("#8a8478") };
    }
    case "hedge": {
      const sway = noise2(cx * 0.3, ctx.t / 1800, 52);
      return { glyph: g(r < 0.5 ? "♣" : "\""), fg: mix(c("#2e5a20"), c("#4e7a34"), sway), bg: c("#1a3214") };
    }
    case "stone":
    default: {
      // Coursed stone: blocks two cells long, a mortar line between courses, each block its own grey.
      const block = Math.floor((cx + (cy & 1)) / 2);
      const v = hash01(block, cy, 55);
      const face = scale(c("#7a7268"), 0.82 + 0.3 * v);
      const joint = (cx + (cy & 1)) % 2 === 0;
      return { glyph: g(joint ? "▌" : r < 0.2 ? "▒" : "█"), fg: face, bg: c("#2c2824") };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Surfaces: patches lying on the ground (the BG3 / Divinity kind). depth is 0 at the patch's
// ragged edge and 1 at its heart: the edge lets the ground show through.

interface SurfaceStyle { bg: RGB; fg: RGB; glyphs: string; still?: boolean; sheen?: "rainbow" | "glint" | "foam" | "wet"; alpha: number }
const SURFACES: Record<SurfaceKind, SurfaceStyle> = {
  water: { bg: c("#1c3c5c"), fg: c("#6aa8d8"), glyphs: "  ~ ", sheen: "glint", alpha: 0.8 },
  oil: { bg: c("#100e0c"), fg: c("#3a3428"), glyphs: "   ~", sheen: "rainbow", alpha: 0.9 },
  spirits: { bg: c("#2a3e46"), fg: c("#c8e4e4"), glyphs: "  · ", sheen: "glint", alpha: 0.62 },
  blood: { bg: c("#3c060a"), fg: c("#8a1018"), glyphs: "   ·", still: true, sheen: "wet", alpha: 0.9 },
  ale: { bg: c("#5a3a10"), fg: c("#e8d090"), glyphs: "  · ", sheen: "foam", alpha: 0.75 },
  wine: { bg: c("#3a0a1e"), fg: c("#9a2a4a"), glyphs: "    ", sheen: "wet", alpha: 0.85 },
  slops: { bg: c("#3a3424"), fg: c("#7a6a4a"), glyphs: " , .", alpha: 0.75 },
  milk: { bg: c("#c8c4b8"), fg: c("#f4f0e8"), glyphs: "    ", sheen: "glint", alpha: 0.8 },
  honey: { bg: c("#8a5a10"), fg: c("#e8b040"), glyphs: "    ", sheen: "wet", alpha: 0.85 },
  ink: { bg: c("#0c0c1a"), fg: c("#2a2a5a"), glyphs: "    ", sheen: "wet", alpha: 0.9 },
  tar: { bg: c("#0c0a08"), fg: c("#2a2620"), glyphs: "    ", sheen: "wet", alpha: 0.95 },
  mud: { bg: c("#241a10"), fg: c("#4a3a24"), glyphs: " ,. ", sheen: "wet", alpha: 0.85 },
  ash: { bg: c("#3a3836"), fg: c("#8e8a84"), glyphs: "·∙,.  ", still: true, alpha: 0.7 },
  char: { bg: c("#141010"), fg: c("#3a2c24"), glyphs: ",∙  ", still: true, alpha: 0.85 },
  ice: { bg: c("#3e6278"), fg: c("#d8f4ff"), glyphs: "  ·╱ ", sheen: "glint", alpha: 0.85 },
  snow: { bg: c("#b8c4d0"), fg: c("#ffffff"), glyphs: " ∙  ", still: true, alpha: 0.9 },
  dust: { bg: c("#5a4e34"), fg: c("#b8a478"), glyphs: "·  ", still: true, alpha: 0.4 },
  grain: { bg: c("#6a5a2a"), fg: c("#d8c070"), glyphs: "∙,·", still: true, alpha: 0.75 },
  straw: { bg: c("#4a3e1e"), fg: c("#b8a04a"), glyphs: "\"',", still: true, alpha: 0.75 },
  acid: { bg: c("#2a4a0a"), fg: c("#b0f040"), glyphs: "  ° ", sheen: "glint", alpha: 0.8 },
  slime: { bg: c("#1e3a1a"), fg: c("#6ac04a"), glyphs: "  ° ", sheen: "wet", alpha: 0.85 },
  vomit: { bg: c("#5a5a2a"), fg: c("#a8a050"), glyphs: " ,. ", alpha: 0.8 },
  grease: { bg: c("#2a2414"), fg: c("#8a7a40"), glyphs: "   ~", sheen: "wet", alpha: 0.8 },
  // What a burned-out patch leaves: blackened floor, pale ash in the cracks.
  scorch: { bg: c("#161210"), fg: c("#6e665e"), glyphs: ",·∙  ", still: true, alpha: 0.85 },
};
const SHEEN = [c("#b070e0"), c("#40c0c0"), c("#e0c040"), c("#e06090"), c("#60e090")];

/** What liquid or residue a name or role means, if any ("an oil slick" -> oil, "the river" -> water). */
export function surfaceKindOf(word: string | undefined): SurfaceKind | undefined {
  if (!word) return undefined;
  const w = word.toLowerCase();
  if (/water|puddle|rain|brine|dishwater/.test(w)) return "water";
  if (/oil|grease|naphtha|pitch|lamp-oil/.test(w)) return /pitch|tar/.test(w) ? "tar" : "oil";
  if (/gin|spirit|brandy|whisk|rum|vodka|liquor|schnapps|absinthe|moonshine|alcohol|poteen/.test(w)) return "spirits";
  if (/blood|gore|ichor/.test(w)) return "blood";
  if (/ale|beer|stout|porter|mead|cider|lager/.test(w)) return "ale";
  if (/wine|claret|sherry|port\b|vinegar/.test(w)) return "wine";
  if (/slop|swill|dregs|sewage|bilge|filth/.test(w)) return "slops";
  if (/milk|cream/.test(w)) return "milk";
  if (/honey|treacle|syrup|molasses/.test(w)) return "honey";
  if (/ink|dye/.test(w)) return "ink";
  if (/\btar\b/.test(w)) return "tar";
  if (/mud|muck|sludge|silt|clay/.test(w)) return "mud";
  if (/ash|cinder/.test(w)) return "ash";
  if (/char|soot|scorch|burnt|burned/.test(w)) return "char";
  if (/ice|frost|sleet/.test(w)) return "ice";
  if (/snow/.test(w)) return "snow";
  if (/dust|sawdust|flour|powder/.test(w)) return "dust";
  if (/grain|wheat|barley|corn|oats|seed/.test(w)) return "grain";
  if (/straw|hay/.test(w)) return "straw";
  if (/acid/.test(w)) return "acid";
  if (/slime|ooze/.test(w)) return "slime";
  if (/vomit|sick\b/.test(w)) return "vomit";
  return undefined;
}

/** A surface over a ground cell. */
export function surfaceCell(kind: SurfaceKind, under: TCell, cx: number, cy: number, depth: number, ctx: TerrainContext): TCell {
  if (kind === "water") return puddleOver(under, cx, cy, depth, ctx);
  const st = SURFACES[kind];
  const set = ctx.glyphs ?? "ascii";
  const k = clamp01(depth) * st.alpha;
  const T = ctx.t / 1000;
  const r = hash01(cx, cy, 61);
  let bg = mix(under.bg, st.bg, k);
  let fg = mix(under.fg, st.fg, k);
  const pick = st.glyphs[Math.floor(r * st.glyphs.length)] ?? " ";
  let glyph = depth > 0.35 ? pick : under.glyph;
  let specular = 0;
  if (st.sheen === "rainbow") {
    // Oil: a thin film whose colours slide about slowly.
    const h = noise2(cx * 0.22 + T * 0.12, sq(cy) * 0.22 - T * 0.08, 62);
    const film = smoothstep(0.55, 0.85, noise2(cx * 0.5, sq(cy) * 0.5 + T * 0.2, 63));
    fg = mix(fg, ramp(SHEEN, h), 0.65 * film * k);
    if (film > 0.4 && depth > 0.3) glyph = film > 0.75 ? "≈" : "~";
    bg = mix(bg, ramp(SHEEN, h), 0.1 * film * k);
  } else if (st.sheen === "glint") {
    const glint = hash01(cx, cy, Math.floor(T * 3), 64) < 0.03 && depth > 0.4;
    if (glint) { glyph = "·"; fg = mix(fg, WHITE, 0.7); specular = 0.8; }
  } else if (st.sheen === "foam") {
    if (hash01(cx, cy, Math.floor(T * 2), 65) < 0.06) { glyph = "∙"; fg = mix(fg, WHITE, 0.4); }
  } else if (st.sheen === "wet") {
    // Still, but wet: a highlight that doesn't move, catching what light there is.
    if (r > 0.94 && depth > 0.5) { glyph = "·"; fg = mix(st.bg, WHITE, 0.35); specular = 0.6; }
  }
  if (kind === "ice" && glyph === "╱" && set === "plain") glyph = "/";
  return { glyph: set === "plain" ? inSet(glyph, "plain") : glyph, fg, bg, ...(specular ? { specular } : {}), liquid: !st.still };
}

/** Rainwater on the ground: the sky in it, a slow shiver, the stones showing at the edges. */
export function puddleOver(under: TCell, cx: number, cy: number, depth: number, ctx: TerrainContext): TCell {
  const T = ctx.t / 1000;
  const time = ctx.time ?? "afternoon";
  const k = smoothstep(0.05, 0.6, depth);
  const shiver = noise3(cx * 0.35, sq(cy) * 0.35, T * 0.25, 71);
  const bg = mix(mix(under.bg, scale(SKY[time], 0.55), 0.7 * k), SKY[time], 0.25 * k * shiver);
  const fg = mix(under.fg, mix(SKY[time], WHITE, 0.25), 0.6 * k);
  let glyph = depth > 0.5 ? (shiver > 0.7 ? "~" : " ") : under.glyph;
  let specular = 0, gfg = fg;
  if (depth > 0.45 && hash01(cx, cy, Math.floor(T * 2.5), 72) < 0.025) { glyph = "∙"; gfg = GLINT[time]; specular = 1; }
  return { glyph: (ctx.glyphs ?? "ascii") === "plain" ? inSet(glyph, "plain") : glyph, fg: gfg, bg, specular, liquid: true };
}

// ---------------------------------------------------------------------------------------------
// Fire on the ground (a burning oil slick, burning spirits, a burning floor).

export function flameCell(flame: FlameName, under: TCell, cx: number, cy: number, intensity: number, ctx: TerrainContext): TCell {
  const T = ctx.t / 1000;
  const set = ctx.glyphs ?? "ascii";
  // Heat rises: the noise field moves up the screen, faster at the heart of the fire.
  const heat = clamp01(noise3(cx * 0.45, sq(cy) * 0.35 + T * 2.6, T * 1.4, (ctx.seed ?? 0) + 81) * (0.55 + 0.6 * intensity));
  const ramp8 = FLAME_RAMPS[flame];
  const fg = ramp(ramp8, clamp01(0.3 + 0.75 * heat));
  const bg = mix(under.bg, ramp(ramp8, clamp01(0.06 + 0.32 * heat)), clamp01(0.4 + intensity * 0.6));
  const glyph = heat > 0.68 ? "▲" : heat > 0.5 ? "^" : heat > 0.38 ? "'" : heat > 0.3 ? "·" : under.glyph;
  // The whole patch is alight (its cooler cells are embers): none of it goes dark at night.
  return { glyph: set === "plain" ? inSet(glyph, "plain") : glyph, fg: heat > 0.3 ? fg : mix(under.fg, fg, 0.5), bg, glow: heat > 0.3 || intensity > 0.25 };
}

// ---------------------------------------------------------------------------------------------
// Clouds over everything: smoke, steam, dust, fog, poison gas. density is 0..1 at this cell.

const CLOUDS: Record<CloudKind, { color: RGB; light: RGB; k: number }> = {
  smoke: { color: c("#4a4650"), light: c("#8a8690"), k: 0.62 },
  steam: { color: c("#b8c4d0"), light: c("#eef4fa"), k: 0.46 },
  dust: { color: c("#8a7a54"), light: c("#d8c890"), k: 0.5 },
  fog: { color: c("#6a7484"), light: c("#b8c4d0"), k: 0.5 },
  poison: { color: c("#4a7a2a"), light: c("#9ae04a"), k: 0.55 },
};

/**
 * A cloud over a cell: it veils the cell's colours rather than hiding them, and only its thick
 * parts draw their own wisps. (An opaque block of steam reads as a wall, not as steam.)
 */
export function cloudCell(kind: CloudKind, under: TCell, density: number, ctx: TerrainContext): TCell {
  const cl = CLOUDS[kind];
  const d = clamp01(density) * cl.k;
  const set = ctx.glyphs ?? "ascii";
  const wisp = d > 0.36 && (under.glyph === " " || under.glyph === "·" || under.glyph === "∙" || d > 0.5);
  const glyph = wisp ? (d > 0.52 ? "▒" : "░") : under.glyph;
  return {
    glyph: set === "plain" ? inSet(glyph, "plain") : glyph,
    fg: wisp ? mix(under.bg, cl.light, Math.min(1, 0.35 + d)) : mix(under.fg, cl.light, d * 0.55),
    bg: mix(under.bg, cl.color, d * 0.85),
    ...(under.glow && d < 0.4 ? { glow: true } : {}),
  };
}

/** A drifting cloud's density at a cell: a soft blob round its centre, torn by noise and carried by the wind. */
export function cloudDensity(cx: number, cy: number, centre: { x: number; y: number }, radius: number, ctx: TerrainContext, seed = 0): number {
  const T = ctx.t / 1000;
  const w = ctx.wind ?? { dir: -Math.PI / 2, strength: 0.3 };
  const dx = cx - centre.x, dy = sq(cy) - sq(centre.y);
  const d = Math.hypot(dx, dy) / Math.max(1, radius);
  if (d > 1.4) return 0;
  const n = noise3(cx * 0.22 - Math.cos(w.dir) * T * 1.2, sq(cy) * 0.22 - Math.sin(w.dir) * T * 1.2, T * 0.35, seed + 91);
  const m = noise3(cx * 0.6 + T * 0.4, sq(cy) * 0.6, T * 0.8, seed + 92);
  return clamp01((1 - d * d) * 0.85 + (n - 0.5) * 0.9 + (m - 0.5) * 0.35);
}

// ---------------------------------------------------------------------------------------------
// Weather.

export type Weather = "clear" | "drizzle" | "rain";

/**
 * Rain at a cell this frame, or undefined: drops fall on their columns (slanted by the wind), and
 * where one lands on water it leaves a ring for a moment. Stateless, so any frame is exact.
 */
export function rainAt(cx: number, cy: number, weather: Weather, ctx: TerrainContext, onWater: boolean): { glyph: string; fg: RGB; alpha: number } | undefined {
  if (weather === "clear") return undefined;
  const T = ctx.t / 1000;
  const heavy = weather === "rain";
  const slant = Math.cos(ctx.wind?.dir ?? Math.PI / 2) * (ctx.wind?.strength ?? 0.3) * 0.6;
  const col = Math.round(cx - cy * slant);
  const period = 34;
  const drops = heavy ? 3 : 1;
  const speed = heavy ? 26 : 16;
  for (let j = 0; j < drops; j++) {
    const phase = hash01(col, j, 101) * period;
    const land = hash(col, j, Math.floor((T * speed + phase) / period), 102) % period;
    const y = (T * speed + phase) % period;
    if (Math.floor(y) === cy % period && cy % period < land) return { glyph: slant > 0.15 ? "/" : slant < -0.15 ? "\\" : "'", fg: c(heavy ? "#9ab0c8" : "#8a9cb4"), alpha: heavy ? 0.85 : 0.7 };
    // The splash where it lands: a ring on water, a fleck on the ground.
    const since = y - land;
    if (cy % period === land && since >= 0 && since < 2.2) return onWater ? { glyph: since < 1 ? "°" : "o", fg: c("#b8d0e8"), alpha: 0.75 } : { glyph: since < 1 ? "," : ".", fg: c("#8a9cb4"), alpha: 0.55 };
  }
  return undefined;
}

/** A hex view of a terrain cell (for renderers that speak strings). */
export const hexCell = (t: TCell) => ({ glyph: t.glyph, fg: hexOf(t.fg), bg: hexOf(t.bg) });
