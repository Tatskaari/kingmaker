import type { Point, SceneWorld } from "../../world/scene-world.ts";
import type { MapActor, Tile2 } from "../types.ts";
import { lookOf, type Cell, type Look, type TimeOfDay } from "./appearance.ts";
import { FLAME_LIGHT, hexOf, mix, rgbOf, type FlameName } from "./color.ts";
import type { GlyphSet } from "./glyphs.ts";
import { clamp01, noise1, noise2, seedOf } from "./noise.ts";
import { CAST_LOOKS } from "./people.ts";
import { surfacesOf, type CloudPatch, type SurfacePatch } from "./surfaces.ts";
import { cloudCell, flameCell, groundCell, surfaceCell, type Ground, type TCell } from "./terrain.ts";

/**
 * The look layer's face to the map renderer (src/game/map/render.ts): pure functions, map and
 * world state in, styled cells out, all animated by one clock.
 *
 *   const frame = lookFrame(options.tick, options.time);           // once per render
 *   actorLook(actor, frame)                  -> the actor's cell (glyph, fg, bg, bold, glow), the light it
 *                                               sheds this frame, how high it's raised, a flame above it
 *   groundAt(terrainOrStyle, px, py, frame)  -> a ground face cell, animated (water, grass); px, py are the
 *                                               projected plane's col and row (camera-independent)
 *   const layer = surfaceLayer(world, frame) -> the world's surfaces (puddles, oil, blood, smoke...)
 *     layer.at(feet, under, px, py)          -> what lies on that spot of ground (burning ones burn)
 *     layer.cloud(feet, under)               -> smoke or steam over it
 *     layer.lights                           -> light from burning patches (feet, radius, colour)
 *   lightOf(actor, frame)                    -> the light an actor sheds (tiles), coloured, flickering
 *
 * Time: `t` in milliseconds. A renderer that counts ticks passes tick * msPerTick (lookFrame does
 * that for the map's 100 ms tick).
 */

export interface LookFrame { t: number; time: TimeOfDay; glyphs: GlyphSet }

/** The frame for a render: the map counts ticks; the look layer wants milliseconds. */
export function lookFrame(tick = 0, time: TimeOfDay = "afternoon", glyphs: GlyphSet = "ascii", msPerTick = 100): LookFrame {
  return { t: tick * msPerTick, time, glyphs };
}

/** An actor's look this frame: its cell, plus what the renderer needs to place it. */
export interface ActorLook extends Cell {
  glow: boolean;
  /** Rows to raise it (hanging things, overhead things), at about 2.5 ft a row. */
  lift: number;
  /** Light it sheds this frame, in tiles (5 ft). */
  light?: { radius: number; color: string; intensity: number };
  /** A flame to draw in the cell above it (burning things, in the iso view). */
  above?: Cell;
  alpha: number;
  look: Look;
}

/**
 * A map actor (decor, or a scene-world thing or person as reconcile makes them) as a cell. The
 * map's own decor keeps its authored glyph and colour; anything from a scene's world (it has a
 * ref) is looked up by the rules (the cast keep their letters; "a flock of pigeons" is a flutter
 * of v's, not the map's fallback). States change the look (burning, wet, scorched, smashed,
 * hidden, hanging, lit...), and names the rules don't know get a look from the model's cache.
 */
export function actorLook(actor: MapActor, frame: LookFrame): ActorLook {
  const kind = actor.kind === "player" ? "player" : actor.kind;
  const authored = !actor.ref && actor.kind !== "player";
  const look = lookOf({
    name: actor.name, kind, id: actor.ref ?? actor.id, ...(actor.ref && CAST_LOOKS[actor.ref] ? { cast: actor.ref } : {}), ...(actor.states ? { states: actor.states } : {}),
    ...(actor.kind === "player" ? { player: true } : {}), ...(authored && actor.glyph ? { glyph: actor.glyph } : {}), ...(authored && actor.color ? { color: actor.color } : {}),
  }, { t: frame.t, time: frame.time, glyphs: frame.glyphs, seed: seedOf(actor.id) });
  const out: ActorLook = {
    glyph: look.glyph, fg: look.fg, ...(look.bg ? { bg: look.bg } : {}), ...(look.bold ? { bold: true } : {}),
    glow: !!look.glow, lift: Math.round((look.lift ?? 0) / 2.5), alpha: look.alpha ?? 1, look,
    ...(look.light ? { light: { radius: look.light.radius / 5, color: look.light.color, intensity: look.light.intensity } } : {}),
  };
  if (look.burning) {
    // In the iso view a burning thing has flames licking up out of it.
    const heat = noise1(frame.t / 120, seedOf(actor.id) + 3);
    out.above = { glyph: heat > 0.6 ? "▲" : heat > 0.35 ? "^" : "'", fg: hexOf(mix(rgbOf(look.fg), rgbOf("#ffe680"), heat * 0.6)), bold: true };
  }
  return out;
}

/** The light an actor sheds, in tiles: what the map's lighting() should use instead of a fixed radius. */
export function lightOf(actor: MapActor, frame: LookFrame): { x: number; y: number; radius: number; color: string; intensity: number } | undefined {
  const l = actorLook(actor, frame).light;
  return l ? { x: actor.at.x, y: actor.at.y, ...l } : undefined;
}

/** The map's terrains and styles as the look layer's grounds. */
const GROUND_OF: Record<string, Ground> = {
  floor: "flags", flags: "flags", boards: "boards", cobbles: "cobbles", grass: "grass", dirt: "dirt", water: "water", "deep-water": "deep-water",
  stairs: "steps", bridge: "boards", carpet: "carpet", rubble: "rubble", scorched: "scorched", sand: "sand", mud: "mud", straw: "straw", river: "river",
};

/**
 * A ground face cell, alive: water shimmers and runs, grass sways in the wind, cobbles and boards
 * have their grain. px, py: the projected plane's column and row (project(tile) plus the face
 * cell's offset), so textures stay put as the camera moves. Undefined for grounds it doesn't know
 * (the renderer keeps its own).
 */
export function groundAt(terrainOrStyle: string, px: number, py: number, frame: LookFrame, flow?: { x: number; y: number }): Cell | undefined {
  const g = GROUND_OF[terrainOrStyle];
  if (!g) return undefined;
  const cell = groundCell(g, px, py, { t: frame.t, time: frame.time, glyphs: frame.glyphs, ...(flow ? { flow } : {}) });
  return { glyph: cell.glyph, fg: hexOf(cell.fg), bg: hexOf(cell.bg) };
}

/** Surfaces and clouds over the ground, from a scene world's surface entities (feet). */
export interface SurfaceLayer {
  surfaces: SurfacePatch[];
  clouds: CloudPatch[];
  /** What lies at a spot of ground (feet), drawn over the ground's cell; undefined where nothing does. */
  at(feet: Point, under: Cell, px: number, py: number): (Cell & { glow?: boolean }) | undefined;
  /** Smoke or steam over a spot (feet), drawn over whatever is there. */
  cloud(feet: Point, under: Cell): Cell | undefined;
  /** Light from burning patches (feet). */
  lights: Array<{ x: number; y: number; radius: number; color: string; intensity: number }>;
}

export function surfaceLayer(world: SceneWorld, frame: LookFrame): SurfaceLayer {
  const { surfaces, clouds } = surfacesOf(world);
  const ctx = { t: frame.t, time: frame.time, glyphs: frame.glyphs };
  const fromT = (c: TCell) => ({ glyph: c.glyph, fg: hexOf(c.fg), bg: hexOf(c.bg), ...(c.glow ? { glow: true } : {}) });
  return {
    surfaces, clouds,
    at(feet, under, px, py) {
      let cell: TCell | undefined;
      for (const sp of surfaces) {
        const d = Math.hypot(feet.x - sp.x, feet.y - sp.y) / sp.radius;
        const depth = clamp01((1 - d) * 2.4 + (noise2(feet.x * 0.45, feet.y * 0.45, sp.seed) - 0.5) * 0.9);
        if (depth <= 0.02) continue;
        cell = surfaceCell(sp.states.includes("frozen") ? "ice" : sp.kind, cell ?? toT(under), px, py, depth, ctx);
        if (sp.states.includes("burning") && depth > 0.15) cell = flameCell(sp.kind === "spirits" ? "blue" : "fire", cell, px, py, clamp01(depth * 1.2), { ...ctx, seed: sp.seed });
      }
      return cell ? fromT(cell) : undefined;
    },
    cloud(feet, under) {
      let cell: TCell | undefined;
      for (const cl of clouds) {
        const d = Math.hypot(feet.x - cl.x, feet.y - cl.y) / Math.max(1, cl.radius);
        if (d > 1.3) continue;
        const density = clamp01((1 - d * d) * 0.9 + (noise2(feet.x * 0.3 + frame.t / 2000, feet.y * 0.3, cl.seed) - 0.5) * 0.8) * cl.density;
        if (density < 0.04) continue;
        cell = cloudCell(cl.kind, cell ?? toT(under), density, ctx);
      }
      return cell ? fromT(cell) : undefined;
    },
    lights: surfaces.filter(sp => sp.states.includes("burning")).map(sp => ({
      x: sp.x, y: sp.y, radius: sp.radius + 10, color: sp.kind === "spirits" ? FLAME_LIGHT.blue : FLAME_LIGHT.fire, intensity: 1.1 + 0.25 * noise1(frame.t / 120, sp.seed),
    })),
  };
}

const toT = (c: Cell): TCell => ({ glyph: c.glyph, fg: rgbOf(c.fg), bg: rgbOf(c.bg ?? "#0e0d12") });

/**
 * Fire on a spot of ground (a fight's burning tile, a burning floor): flames rising through what's
 * there, its cooler cells embers. px, py: the projected plane's col and row, as for groundAt.
 */
export function fireAt(under: Cell, px: number, py: number, frame: LookFrame, intensity = 0.85, seed = 0, flame: FlameName = "fire"): Cell & { glow?: boolean } {
  const cell = flameCell(flame, toT(under), px, py, intensity, { t: frame.t, time: frame.time, glyphs: frame.glyphs, seed });
  return { glyph: cell.glyph, fg: hexOf(cell.fg), bg: hexOf(cell.bg), ...(cell.glow ? { glow: true } : {}) };
}

/** Grain dust hanging over a spot (the Heron's floor): a slow drifting haze, and motes where the light catches them. */
export function dustAt(under: Cell, px: number, py: number, frame: LookFrame): Cell {
  const T = frame.t / 1000;
  const density = 0.3 + 0.55 * noise2(px * 0.12 + T * 0.18, py * 0.3 - T * 0.05, 4711);
  const cell = cloudCell("dust", toT(under), density, { t: frame.t, time: frame.time, glyphs: frame.glyphs });
  // A mote: a speck that twinkles in and out where it drifts.
  const mote = noise2(px * 0.9 + T * 0.6, py * 1.7, 4712);
  if (mote > 0.86 && (under.glyph === " " || under.glyph === "·")) return { glyph: frame.glyphs === "plain" ? "." : mote > 0.93 ? "∙" : "·", fg: hexOf(mix(rgbOf("#8a7a54"), rgbOf("#f0e0a8"), (mote - 0.86) * 12)), bg: hexOf(cell.bg) };
  return { glyph: cell.glyph, fg: hexOf(cell.fg), bg: hexOf(cell.bg) };
}

/** A tile's centre in a region's feet (for asking the surface layer about a tile). */
export const tileFeet = (tile: Tile2, origin: Tile2) => ({ x: (tile.x - origin.x) * 5 + 2.5, y: (tile.y - origin.y) * 5 + 2.5 });
