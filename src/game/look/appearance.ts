import { FLAME_LIGHT, FLAME_RAMPS, MATERIAL_COLOR, PALETTE, hexOf, luminance, mix, ramp, rgbOf, scale, desaturate, type FlameName, type RGB } from "./color.ts";
import { glyphFor, nerd, type Glyph, type GlyphSet } from "./glyphs.ts";
import { inventionColor, inventionVersion, invented, requestInvention } from "./invent.ts";
import { parseName, type ParsedName } from "./names.ts";
import { clamp01, flicker, hash01, noise1, seedOf } from "./noise.ts";
import { CAST_LOOKS, PLAYER_LOOK, castLook } from "./people.ts";
import { KIND_ROLES, matchRole, roleById, type LightSpec, type Motion, type Role, type Stamp } from "./roles.ts";

/**
 * The appearance of anything: lookOf(thing, ctx) -> a cell (glyph, fg, bg, bold) plus what a
 * renderer needs to place it well (does it glow, does it light its surroundings and how much this
 * frame, is it raised, faint, several of it, how big).
 *
 * Two halves. baseLook() is what the thing is (rules on the name, tags and kind; the cast table;
 * the model's answer from the cache; or a guess), computed once per kind of thing. lookOf() is how
 * it looks right now: its states (burning, wet, smashed, hidden, hanging, lit...) and its idle
 * motion at time ctx.t. Animation is a pure function of time, so any frame can be drawn on its own.
 */

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night" | "next-morning";

/** Anything with a name: a scene-world Entity, a map actor, or a name the GM just said. */
export interface Lookable {
  name: string;
  kind?: string;
  tags?: readonly string[];
  material?: string;
  size?: string;
  states?: readonly string[];
  id?: string;
  cast?: string;
  player?: boolean;
  quantity?: number;
  /** Set when the stage manager made it up (its material is then only a default). */
  created?: number;
  /** An authored glyph and colour (map decor) to start from. */
  glyph?: string;
  color?: string;
}

export interface LookContext {
  /** Animation clock in milliseconds (real time, not turns). */
  t?: number;
  time?: TimeOfDay;
  glyphs?: GlyphSet;
  /** Per-thing seed, so neighbours don't flicker in step (defaults to a hash of the id or name). */
  seed?: number;
}

export interface Cell { glyph: string; fg: string; bg?: string; bold?: boolean }

export interface Look extends Cell {
  /** Emissive: drawn at full brightness in the dark (flames, lamps, sparks). */
  glow?: boolean;
  /** The light it sheds this frame (already flickered): feet, colour, strength. */
  light?: { radius: number; color: string; intensity: number };
  /** Feet above the ground (hanging, overhead), for renderers that raise things. */
  lift?: number;
  /** 0..1: hidden things are faint, gone things invisible. */
  alpha?: number;
  /** What it was recognised as, and how: for legends and debugging. */
  role: string;
  source: LookSource;
  motion?: Motion;
  /** Draw this many, scattered round the spot (a flock, a crowd). */
  group?: number;
  /** Ground footprint in feet, and how to draw it over several cells. */
  footprint?: [number, number];
  stamp?: Stamp;
  /** 0..1 how hard it's burning this frame (stamps set their cells alight by it). */
  burning?: number;
  flame?: FlameName;
  /** A destroyed thing's remains. */
  wreck?: "char" | "rubble" | "splinters" | "shards" | "puddle" | "scraps" | "gore";
  /** A liquid it would make a puddle of if spilled ("water", "ale", "oil"). */
  liquid?: string;
  being?: boolean;
}

export type LookSource = "player" | "cast" | "authored" | "rule" | "cache" | "model" | "guess";

/** What a thing is, before states and time: computed once per kind of thing. */
export interface BaseLook {
  role: Role;
  glyph: Glyph;
  fg: string;
  bg?: string;
  bold?: boolean;
  motion: Motion;
  light?: LightSpec;
  flame: FlameName;
  /** States its name implies ("a burning branch"), used when the world says nothing. */
  implied: string[];
  group: number;
  source: LookSource;
  being: boolean;
  footprint?: [number, number];
  stamp?: Stamp;
  overhead?: boolean;
  liquid?: string;
  parsed: ParsedName;
  /** Persons keep their letter even in the Nerd set (identity beats an icon). */
  person: boolean;
}

const P = PALETTE;
const COLOR_WORD: Record<string, string> = {
  red: P.crimson, crimson: P.crimson, scarlet: P.scarlet, orange: P.orange, amber: P.amber, yellow: "#e8d050", gold: P.gold, golden: P.gold, gilt: P.gold, gilded: P.gold,
  green: P.leaf, emerald: "#3ac870", blue: P.azure, azure: P.azure, navy: P.navy, teal: P.teal, cyan: P.cyan, purple: P.purple, violet: P.violet, royal: P.royal,
  pink: P.pink, rose: "#e87a9a", white: P.white, ivory: P.cream, black: "#56546a", ebony: "#4a4050", grey: P.grey, gray: P.grey, silver: P.silver, silvery: P.silver,
  brown: P.walnut, tan: P.tan, copper: P.copper, bronze: "#c08a40", brass: P.brass, rusty: P.rust, rust: P.rust, tarred: "#4a4038", lavender: P.lilac, lilac: P.lilac,
  mauve: "#b088a8", magenta: P.magenta, indigo: "#5a4ab0", ginger: "#e08a3a", tawny: "#c89050", russet: "#a8502a", ochre: "#c8902a", ashen: "#8a8680",
};
const FLAME_WORD: Record<string, FlameName> = { blue: "blue", azure: "blue", navy: "blue", teal: "blue", cyan: "blue", green: "green", emerald: "green", purple: "violet", violet: "violet", indigo: "violet", magenta: "violet" };
const GROUP_SIZE: Record<string, number> = { flock: 6, crowd: 5, swarm: 8, pack: 3, herd: 4, gang: 4, mob: 6, throng: 7, school: 5, colony: 6, murder: 5, parliament: 4, horde: 7, rabble: 6, gaggle: 5 };
const PERSON_ROLES = new Set(["crowd", "child", "guard", "royal", "person"]);
/** Surfaces by tag: glyph, colour, flame (spirits burn blue), idle motion. */
const SURFACE_LOOKS: Array<[string, string, string, FlameName, Motion]> = [
  ["water", "~", "#4a8ab8", "fire", "shimmer"], ["oil", "≈", "#5a5040", "fire", "shimmer"], ["spirits", "≈", "#b8d0d0", "blue", "shimmer"],
  ["ale", "~", "#c89040", "fire", "shimmer"], ["blood", "~", "#8a1018", "fire", "still"], ["grease", "≈", "#8a7a40", "fire", "still"],
  ["ice", "▒", "#cfefff", "fire", "shimmer"], ["ash", ",", "#6e665e", "fire", "still"], ["smoke", "░", "#8a8690", "fire", "drift"], ["steam", "░", "#dfe6ee", "fire", "drift"],
];
const BURN_LIGHT: Record<string, number> = { tiny: 5, small: 8, medium: 12, large: 18, huge: 26, gargantuan: 34 };

// ---------------------------------------------------------------------------------------------
// Base looks.

const bases = new Map<string, { base: BaseLook; version: number }>();

export function baseLook(thing: Lookable): BaseLook {
  const key = `${thing.name}|${thing.kind ?? ""}|${(thing.tags ?? []).join(",")}|${thing.material ?? ""}|${thing.created ? "c" : ""}|${thing.cast ?? ""}|${thing.player ? "p" : ""}|${thing.glyph ?? ""}|${thing.color ?? ""}|${thing.quantity ?? ""}`;
  const hit = bases.get(key);
  // Guesses are revisited when the model's answers land; everything else is final.
  if (hit && (hit.base.source !== "guess" || hit.version === inventionVersion())) return hit.base;
  const base = computeBase(thing);
  bases.set(key, { base, version: inventionVersion() });
  if (bases.size > 5000) bases.clear();
  return base;
}

/** Forget cached base looks (after the cache or the rules change). */
export const resetLooks = () => bases.clear();

function computeBase(thing: Lookable): BaseLook {
  const parsed = parseName(thing.name);
  const tags = thing.tags ?? [];
  const kind = thing.kind;
  const beingKind = kind === "person" || kind === "creature" || kind === "player";
  // Material from the world, unless the stage manager defaulted it (it makes everything of wood).
  const material = thing.created && thing.material === "wood" ? undefined : thing.material;

  if (thing.player || kind === "player") return person(parsed, { glyph: { ascii: PLAYER_LOOK.glyph }, fg: PLAYER_LOOK.color, bold: true, source: "player" });
  // A surface (systems.ts): its tags say what it is. Drawn as a patch by renderers that can; this is its one-cell look.
  if (kind === "surface") {
    const stuff = SURFACE_LOOKS.find(([tag]) => tags.includes(tag)) ?? SURFACE_LOOKS[0]!;
    const [, ascii, fg, flame, motion] = stuff;
    const role: Role = { id: `surface:${stuff[0]}`, glyph: { ascii, ...(stuff[0] === "water" ? { nerd: nerd("water")! } : stuff[0] === "smoke" || stuff[0] === "steam" ? { nerd: nerd("smoke")! } : {}) }, fg, motion, liquid: stuff[0] };
    return { role, glyph: role.glyph, fg, motion, flame, implied: [], group: 0, source: "rule", being: false, liquid: stuff[0], parsed, person: false };
  }
  const cast = thing.cast ?? (beingKind && thing.id && CAST_LOOKS[thing.id] ? thing.id : undefined);
  if (cast && beingKind) {
    const look = castLook(cast, thing.name);
    return person(parsed, { glyph: { ascii: look.glyph }, fg: look.color, bold: true, source: "cast" });
  }

  const match = matchRole(parsed, tags, kind);
  let role: Role;
  let source: LookSource;
  let glyph: Glyph;
  let fg: string;
  if (thing.glyph) {
    role = match?.role ?? KIND_ROLES[kind ?? "object"] ?? KIND_ROLES.object!;
    source = "authored";
    glyph = { ascii: thing.glyph, ...(role.glyph.nerd ? { nerd: role.glyph.nerd } : {}) };
    fg = thing.color ?? role.fg;
  } else if (match) {
    role = match.role;
    source = "rule";
    glyph = role.glyph;
    fg = role.byMaterial && material && MATERIAL_COLOR[material] ? MATERIAL_COLOR[material]! : role.fg;
  } else {
    const cached = invented(parsed.key);
    if (cached) {
      role = { id: `invented:${parsed.key}`, glyph: { ascii: cached.glyph, ...(cached.nerd && nerd(cached.nerd) ? { nerd: nerd(cached.nerd)! } : {}) }, fg: inventionColor(cached),
        motion: cached.motion, being: cached.being, group: cached.group,
        ...(cached.light ? { light: { radius: 12, color: inventionColor(cached), intensity: 0.8, flicker: cached.motion === "flicker" ? 0.3 : 0.08, when: "always" as const } } : {}) };
      source = "cache";
    } else {
      // A guess by kind (the roguelike way for beasts: the first letter of what it is), and ask the model.
      const generic = KIND_ROLES[beingKind ? (kind === "person" ? "person" : "creature") : kind ?? "object"] ?? KIND_ROLES.object!;
      const letter = kind === "creature" ? (parsed.head.match(/[a-z]/)?.[0] ?? "c") : undefined;
      role = { ...generic, ...(letter ? { glyph: { ascii: letter } } : {}) };
      source = "guess";
      requestInvention({ key: parsed.key, name: thing.name, ...(kind ? { kind } : {}) });
    }
    glyph = role.glyph;
    fg = role.byMaterial && material && MATERIAL_COLOR[material] ? MATERIAL_COLOR[material]! : role.fg;
  }

  // Colour words ("the blue driftwood fire", "Prout's good black boots") and their flames.
  let flame: FlameName = role.flame ?? "fire";
  for (const c of parsed.colors) {
    if (COLOR_WORD[c] && !thing.color) fg = COLOR_WORD[c]!;
    if (FLAME_WORD[c]) flame = FLAME_WORD[c]!;
    if (c === "pale") fg = hexOf(mix(rgbOf(fg), rgbOf(P.white), 0.35));
    if (c === "dark") fg = hexOf(scale(rgbOf(fg), 0.65));
  }
  // Spirits burn blue.
  if ((role.liquid === "spirits" || tags.includes("spirits")) && flame === "fire") flame = "blue";
  const being = !!role.being || beingKind;
  const groupWord = parsed.group;
  const group = groupWord ? GROUP_SIZE[groupWord] ?? 4 : role.group ? 4 : being && parsed.plural ? 3 : 0;
  const isPerson = PERSON_ROLES.has(role.id) || kind === "person";
  return {
    role, glyph, fg, ...(role.bg ? { bg: role.bg } : {}), ...(role.bold || being ? { bold: true } : {}),
    motion: role.motion ?? "still", ...(role.light ? { light: role.light } : {}), flame, implied: [...new Set([...parsed.states, ...(role.states ?? [])])],
    group, source, being, ...(role.footprint ? { footprint: role.footprint } : {}), ...(role.stamp ? { stamp: role.stamp } : {}),
    ...(role.overhead || tags.includes("overhead") ? { overhead: true } : {}), ...(role.liquid ? { liquid: role.liquid } : {}), parsed, person: isPerson,
  };
}

function person(parsed: ParsedName, look: { glyph: Glyph; fg: string; bold: boolean; source: LookSource }): BaseLook {
  return { role: { id: look.source === "player" ? "player" : "person", glyph: look.glyph, fg: look.fg, being: true }, glyph: look.glyph, fg: look.fg, bold: look.bold,
    motion: "still", flame: "fire", implied: parsed.states, group: 0, source: look.source, being: true, parsed, person: true };
}

// ---------------------------------------------------------------------------------------------
// The look right now.

const SOOT = rgbOf("#2a2420"), CHAR = rgbOf("#3a2c24"), EMBER = rgbOf("#d8481a"), WET = rgbOf("#5a7a9a"), ICE = rgbOf("#cfefff"), POISON = rgbOf("#8fdc3a");
const BLOOD = rgbOf("#a01818"), ROT = rgbOf("#6a7a3a"), WHITE = rgbOf("#ffffff"), OIL_SHEEN = [rgbOf("#b070e0"), rgbOf("#40c0c0"), rgbOf("#e0c040"), rgbOf("#e06090")];
const DOWN = new Set(["dead", "unconscious", "prone", "down", "asleep", "sleeping", "stunned", "paralyzed", "paralysed", "petrified"]);

export function lookOf(thing: Lookable, ctx: LookContext = {}): Look {
  const base = baseLook(thing);
  const t = ctx.t ?? 0;
  const seed = ctx.seed ?? seedOf(thing.id ?? thing.name);
  const set: GlyphSet = ctx.glyphs ?? "ascii";
  // The world's states, or (when it says nothing) what the name implies.
  const states = new Set(thing.states?.length ? thing.states : base.implied);
  const has = (s: string) => states.has(s);
  const tags = thing.tags ?? [];

  const out: Look = { glyph: glyphFor(base.person && set === "nerd" ? { ascii: base.glyph.ascii } : base.glyph, set), fg: base.fg, role: base.role.id, source: base.source, motion: base.motion };
  if (base.bg) out.bg = base.bg;
  if (base.bold) out.bold = true;
  if (base.footprint) out.footprint = base.footprint;
  if (base.stamp) out.stamp = base.stamp;
  if (base.liquid) out.liquid = base.liquid;
  if (base.being) out.being = true;
  if (base.group > 1) out.group = Math.min(base.group, thing.quantity && thing.quantity > 1 ? thing.quantity : base.group);
  else if (base.being && thing.quantity && thing.quantity > 1) out.group = Math.min(thing.quantity, 6);
  if (has("gone")) return { ...out, alpha: 0 };

  let fg = rgbOf(out.fg);
  let bg = out.bg ? rgbOf(out.bg) : undefined;
  const glyphIn = (ascii: string) => glyphFor({ ascii }, set);
  const sized = (BURN_LIGHT[thing.size ?? (base.being ? "medium" : "small")] ?? 10);

  // Doors, hatches and lids say whether they're open.
  if (base.role.id === "door" || tags.includes("door")) {
    const open = has("open") || has("broken");
    const shut = has("locked") || has("barred") || has("bolted");
    if (open) { out.glyph = set === "nerd" ? nerd("door_open")! : glyphIn("'"); fg = scale(fg, 0.85); }
    else if (shut) { out.glyph = set === "nerd" ? nerd("door_closed_lock")! : glyphIn("+"); fg = scale(fg, 0.7); out.bold = true; }
  }
  if (base.role.id === "hatch" && has("open")) { out.glyph = glyphIn("■"); fg = rgbOf("#120e0c"); }
  if (has("overturned")) {
    if (base.role.id === "table") out.glyph = glyphIn("╨");
    else if (base.role.id === "chair" || base.role.id === "armchair") out.glyph = glyphIn("╨");
    else if (base.role.id === "barrel" || base.role.id === "bucket" || base.role.id === "cup") out.glyph = glyphIn("○");
  }

  // Lights: on, off, flickering.
  const lightSpec = base.light;
  const burningNow = has("burning") && !has("wet");
  const isFlame = base.role.id === "fire" || base.role.id === "hearth" || base.role.id === "brazier" || base.role.id === "torch" || base.role.id === "candle" || base.role.id === "candelabra" || base.role.id === "lamp-post" || base.role.id === "lantern";
  const lit = !!lightSpec && !has("destroyed") && !has("unlit") && !(has("wet") && isFlame && lightSpec.when === "lit") &&
    (lightSpec.when === "always" ? !has("out") : has("lit") || burningNow || tags.includes("light") && !has("unlit") && base.role.id !== "lantern" && base.role.id !== "candle");
  if (lightSpec && lit) {
    const f = flicker(t, seed, 1);
    const k = lightSpec.flicker ?? 0.1;
    const color = isFlame && base.flame !== "fire" ? FLAME_LIGHT[base.flame] : lightSpec.color;
    out.light = { radius: lightSpec.radius * (1 + k * (f - 0.5) * 0.35), color, intensity: (lightSpec.intensity ?? 1) * (1 - k * 0.5 + k * f) };
    out.glow = true;
    if (isFlame || base.motion === "flicker") fg = ramp(FLAME_RAMPS[base.flame], clamp01(0.42 + 0.55 * f));
    if (base.role.id === "fire" || base.role.id === "hearth") { out.burning = 0.55 + 0.45 * f; out.flame = base.flame; }
  } else if (lightSpec && lightSpec.when === "lit" && !has("burning")) {
    fg = scale(fg, 0.72);
  }

  // Idle motion: only living, burning or glinting things move.
  switch (base.motion) {
    case "shimmer": {
      const g = Math.max(0, noise1(t / 260, seed) - 0.72) / 0.28;
      if (g > 0) fg = mix(fg, WHITE, g * 0.55);
      break;
    }
    case "flutter": {
      const flap = noise1(t / 150, seed) > 0.5;
      if (set !== "nerd" && out.glyph === "v") out.glyph = flap ? "v" : "V";
      out.lift = flap ? 1 : 0;
      break;
    }
    case "sway": fg = scale(fg, 0.9 + 0.2 * noise1(t / 900, seed)); break;
    case "bob": fg = scale(fg, 0.92 + 0.12 * noise1(t / 500, seed)); break;
    case "pulse": fg = scale(fg, 0.75 + 0.45 * (0.5 + 0.5 * Math.sin(t / 420 + (seed % 100)))); break;
    case "swarm": if (set !== "nerd") out.glyph = glyphIn(["·", "∙", "'", "·", ","][Math.floor(t / 120 + (seed % 7)) % 5]!); break;
    case "drift": if (set !== "nerd" && (out.glyph === "░" || out.glyph === "▒")) out.glyph = glyphIn(noise1(t / 700, seed) > 0.5 ? "░" : "▒"); out.alpha = 0.75; break;
    default: break;
  }

  // Destroyed: what's left.
  if (has("destroyed")) {
    const burnt = burningNow || has("smouldering") || has("scorched") || has("burnt");
    const m = thing.material ?? "wood";
    if (burnt || (tags.includes("flammable") && has("burnt"))) {
      out.wreck = "char";
      out.glyph = glyphIn("%");
      fg = CHAR;
      if (burningNow) burn(out, base, t, seed, sized, set, true);
      else if (has("smouldering")) {
        const p = 0.5 + 0.5 * Math.sin(t / 380 + seed % 50);
        fg = mix(CHAR, EMBER, p * 0.8);
        out.glow = p > 0.6;
        out.light = { radius: 4, color: "#ff5a1a", intensity: 0.35 + 0.25 * p };
      }
    } else if (m === "glass" || m === "crystal" || m === "ice") { out.wreck = "shards"; out.glyph = glyphIn("'"); fg = scale(fg, 0.9); }
    else if (m === "liquid") { out.wreck = "puddle"; out.glyph = glyphIn("~"); }
    else if (m === "stone" || m === "iron" || m === "steel" || m === "brass" || m === "silver") { out.wreck = "rubble"; out.glyph = glyphIn(","); fg = scale(desaturate(fg, 0.5), 0.8); }
    else if (m === "cloth" || m === "paper" || m === "rope" || m === "leather") { out.wreck = "scraps"; out.glyph = glyphIn(","); fg = scale(fg, 0.7); }
    else if (m === "flesh") { out.wreck = "gore"; out.glyph = glyphIn("%"); fg = mix(fg, BLOOD, 0.5); }
    else { out.wreck = "splinters"; out.glyph = glyphIn("%"); fg = scale(fg, 0.62); }
    out.bold = false;
  } else if (burningNow) {
    burn(out, base, t, seed, sized, set, false);
    fg = rgbOf(out.fg);
  } else if (has("smouldering")) {
    const p = 0.5 + 0.5 * Math.sin(t / 420 + seed % 50);
    fg = mix(mix(fg, CHAR, 0.6), EMBER, p * 0.55);
    out.light = { radius: 5, color: "#ff5a1a", intensity: 0.3 + 0.2 * p };
  }

  // Marks of what happened to it.
  if (!out.burning) {
    if (has("scorched") || has("burnt") || has("singed") || has("charred")) fg = mix(fg, SOOT, 0.42);
    if (has("oiled")) {
      const h = noise1(t / 1400 + (seed % 13), seed);
      const sheen = ramp(OIL_SHEEN, h);
      fg = mix(scale(fg, 0.7), sheen, 0.18 + 0.2 * Math.max(0, noise1(t / 300, seed + 3) - 0.6) / 0.4);
    }
    if (has("wet") || has("soaked")) {
      fg = mix(scale(fg, 0.8), WET, 0.22);
      if (bg !== undefined) bg = mix(scale(bg, 0.8), WET, 0.15);
      if (noise1(t / 240, seed + 9) > 0.86) fg = mix(fg, WHITE, 0.35);
    }
    if (has("frozen")) { fg = mix(fg, ICE, 0.55); out.bold = true; if (base.liquid || thing.material === "liquid") out.glyph = glyphIn("▒"); }
    if (has("poisoned")) fg = mix(fg, POISON, 0.3 + 0.15 * Math.sin(t / 500 + seed % 40));
    if (has("bloodied") || has("bloody")) fg = mix(fg, BLOOD, 0.35);
    if (has("rotten")) fg = mix(fg, ROT, 0.4);
    if (has("broken")) fg = scale(fg, 0.78);
    if (has("damaged")) fg = scale(fg, 0.88);
    if (has("empty") && (base.role.id === "sack" || base.role.id === "barrel")) fg = scale(fg, 0.85);
  }

  // Beings down, asleep, dead.
  if (base.being) {
    const down = [...states].find(s => DOWN.has(s));
    if (down === "dead") { out.glyph = glyphIn("%"); fg = scale(fg, 0.6); out.bold = false; }
    else if (down) { fg = scale(fg, 0.62); out.bold = false; }
  }

  // Where it is: hanging, overhead, hidden.
  if (has("hanging")) {
    out.lift = 7;
    out.motion = "sway";
  }
  if (base.overhead || has("overhead")) { out.lift = Math.max(out.lift ?? 0, 8); out.alpha = Math.min(out.alpha ?? 1, 0.7); }
  if (has("hidden")) { out.alpha = Math.min(out.alpha ?? 1, 0.38); fg = desaturate(fg, 0.5); }
  if (has("fallen")) out.lift = 0;

  out.fg = hexOf(fg);
  if (bg !== undefined) out.bg = hexOf(bg);
  return out;
}

/** Set a look alight: flame colours, an ember glow behind, the thing's own glyph showing through. */
function burn(out: Look, base: BaseLook, t: number, seed: number, radius: number, set: GlyphSet, wreck: boolean): void {
  const flames = FLAME_RAMPS[base.flame];
  const heat = flicker(t, seed, 1.35);
  out.fg = hexOf(ramp(flames, clamp01(0.4 + 0.58 * heat)));
  out.bg = hexOf(ramp(flames, clamp01(0.08 + 0.26 * heat)));
  // Qud-style: the thing and its flames take turns, each on its own beat.
  const tongue = noise1(t / 130, seed + 5);
  if (tongue > 0.6) out.glyph = glyphFor({ ascii: heat > 0.62 ? "▲" : "^" }, set === "nerd" ? "ascii" : set);
  else if (wreck) out.glyph = glyphFor({ ascii: "%" }, set === "nerd" ? "ascii" : set);
  out.bold = true;
  out.glow = true;
  out.burning = 0.5 + 0.5 * heat;
  out.flame = base.flame;
  out.light = { radius: radius * (0.92 + 0.16 * heat), color: FLAME_LIGHT[base.flame], intensity: 0.85 + 0.35 * heat };
}

/** The look in each glyph set, for legends (ascii, nerd, plain), and how it was decided. */
export function describeLook(thing: Lookable): { ascii: string; nerd: string; plain: string; fg: string; role: string; source: LookSource; key: string } {
  const base = baseLook(thing);
  return { ascii: glyphFor(base.glyph, "ascii"), nerd: glyphFor(base.person ? { ascii: base.glyph.ascii } : base.glyph, "nerd"), plain: glyphFor(base.glyph, "plain"), fg: base.fg, role: base.role.id, source: base.source, key: base.parsed.key };
}

/** Is it dark? (Luminance of a hex colour, for renderers that keep important things legible.) */
export const brightness = (hex: string) => luminance(rgbOf(hex));

/** A role's look by id (stamps and particles borrow them: "fire", "water"...). */
export const roleLook = (id: string): Role | undefined => roleById(id);

/** A tiny deterministic jitter for scattering a group round its spot (feet). */
export function scatter(seed: number, i: number, radius: number): { dx: number; dy: number } {
  const a = hash01(seed, i, 1) * Math.PI * 2, r = radius * (0.35 + 0.65 * Math.sqrt(hash01(seed, i, 2)));
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}
