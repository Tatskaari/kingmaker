import type { SceneWorld } from "../../world/scene-world.ts";
import type { MapActor, Region, Span, StoryState, StyledLine, Tile2, TileMap } from "../types.ts";
import { FLAME_RAMPS, hexOf, mix as mixRGB, ramp, rgbOf, scale as scaleRGB, type FlameName, type RGB } from "../look/color.ts";
import { areaCell, type EffectFrame, type FloatText } from "../look/effects.ts";
import { glyphSet, inSet, plainText, type GlyphSet } from "../look/glyphs.ts";
import { shadeBeing, shadeBy } from "../look/light.ts";
import { actorLook, dustAt, fireAt, groundAt, surfaceLayer, type ActorLook, type LookFrame, type SurfaceLayer } from "../look/map.ts";
import { clamp01, hash01, noise2, seedOf } from "../look/noise.ts";
import { BLOCKS, DAYLIGHT, DEFAULT_STYLE, FIRE, GROUND, TREE, WINDOW_LIGHT, hash, pick, scale, type BlockLook, type GroundLook } from "./palette.ts";
import { raiseFor } from "./looks.ts";
import { inBounds, isRoofed, isStructure, regionAt, tileAt, type MapTile, type PlaceRegion } from "./tiles.ts";

/**
 * The isometric ASCII renderer. The viewer stands to the south-west, looking north-east: a tile
 * (x, y) projects to column 2(x + y) and row (y - x), so the map's north runs up-left on screen and
 * its east up-right. Each tile owns a flat lozenge of three cells on its row plus the cell under its
 * middle, which tiles the plane in diamonds. Built things are blocks raised by their height in rows,
 * painted back to front: a lit top, the west face, the south face.
 *
 * Indoors, the room you're in loses its roof and its front walls (the south and west ones, between
 * you and the viewer) are cut down to a ledge, so you can see in. Outdoors nothing is cut; if a
 * building hides you, you're drawn through it.
 *
 * The look layer (src/game/look) decides how things, ground and surfaces look, alive: people and
 * things by the rules from their names and states (burning, wet, smashed, hanging...), living
 * ground (water runs, grass sways in the wind), the puddles, slicks and smoke in a scene's world,
 * coloured light that walls stop (the Rat's driftwood fire lights it blue), and effects (a
 * fireball, a splash, damage numbers, barks) projected onto the map. One clock drives it all: `t`,
 * in milliseconds. Plain text (color: false) is quiet: no motion, no effects, no icons.
 *
 * Things look as much in the way as they are: what stands in the way fills its square (a cart has
 * its wheels either side, a stall its awning, the statue its plinth), and small things you can walk
 * past (a lamp, a sign) stand up on their posts. For the mouse, a frame can say what's drawn where
 * (Picks): the tile and the person or thing in every cell, as drawn, so a click picks what the
 * player is looking at. `hover` lights up the tile under the pointer.
 */

export interface Viewport { w: number; h: number }

export interface RenderOptions {
  time?: StoryState["time"];
  /** The lead marker: where the story is heading, on this map. */
  lead?: Tile2;
  /** Named on the edge arrow when the lead is off screen ("the Drowned Rat"). */
  leadLabel?: string;
  /** Whose surroundings to open up (default: the camera tile). */
  focus?: Tile2;
  /** The animation clock in milliseconds: water runs, fire flickers, effects play, the lead pulses. */
  t?: number;
  /** The clock in the map's old 100 ms ticks, when `t` isn't given. */
  tick?: number;
  /** false: plain characters, no colours (logs and tests). */
  color?: boolean;
  /** The glyph set (default: KM_GLYPHS, or what the terminal suggests); plain text never uses icons. */
  glyphs?: GlyphSet;
  /** States of regions by region id, from scenes: "burning", "exploded", "scorched". */
  regionStates?: Record<string, string[]>;
  /** Lift every roof (scene and combat views show the whole place). Default: only the room you're in. */
  roofs?: boolean;
  /** Cut walls away round the focus (default true). */
  cutaway?: boolean;
  /** More tiles whose rooms open up like the focus's (a scene view: wherever its people are). */
  reveal?: Tile2[];
  /** Tiles to tint (combat: where you can move, what's in reach), with an optional glyph. */
  marks?: Array<{ at: Tile2; color: string; glyph?: string }>;
  /** A selected tile, bracketed: [K] (targeting, looking). */
  cursor?: Tile2;
  /** Scene worlds on this map, each lined up by its region: their surfaces (puddles, oil, blood, smoke) lie on its ground. */
  worlds?: Array<{ region: Region; world: SceneWorld }>;
  /** What's playing (an Effects frame, in a region's world feet), projected onto the map. */
  effects?: { region: Region; frame: EffectFrame };
  /** Tiles on fire (a fight's, a burning floor), thick with dust (the Heron's floor), or scorched. */
  hazards?: { fire?: Tile2[]; dust?: Tile2[]; scorched?: Tile2[] };
  /** The tile under the pointer: everything drawn for it is lit up. */
  hover?: Tile2;
  /** Filled in with what's drawn where, for the mouse (see Picks). */
  pick?: Picks;
}

/**
 * What a frame drew where, for the mouse: for each viewport cell, the map tile whose drawing shows
 * there (a wall's face belongs to the wall, a lamp up its post to the lamp's tile, the lead's marker
 * to the lead) and who or what is drawn in it. render() fills it in as it paints, so picking always
 * agrees with drawing: a click on someone's letter is a click on them, wherever the camera is.
 */
export class Picks {
  w = 0;
  h = 0;
  /** The map the frame was of. */
  map = "";
  private width = 1;
  private tiles: Int32Array = new Int32Array(0);
  private actors: Array<MapActor | undefined> = [];

  /** Take a frame's picks (render() calls this). */
  fill(w: number, h: number, map: TileMap, tiles: Int32Array, actors: Array<MapActor | undefined>): void {
    this.w = w; this.h = h; this.map = map.id; this.width = map.width; this.tiles = tiles; this.actors = actors;
  }

  /**
   * Some cells' picks from another frame of the same view, by index (y * w + x): x-ray shows what's
   * behind a building through it, and a click there is on what shows.
   */
  take(from: Picks, cells: Iterable<number>): void {
    if (from.map !== this.map || from.w !== this.w || from.h !== this.h) return;
    for (const i of cells) { this.tiles[i] = from.tiles[i]!; this.actors[i] = from.actors[i]; }
  }

  /** The tile drawn at a viewport cell and who or what is drawn there; undefined where nothing of the map is. */
  at(sx: number, sy: number): { at: Tile2; actor?: MapActor } | undefined {
    if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) return undefined;
    const i = this.tiles[sy * this.w + sx]!;
    if (i < 0) return undefined;
    const actor = this.actors[sy * this.w + sx];
    return { at: { x: i % this.width, y: Math.floor(i / this.width) }, ...(actor ? { actor } : {}) };
  }
}

/** Light falling on a tile: three multipliers (1 is as authored). */
interface Light { r: number; g: number; b: number }

/** A cell being composed: colours packed (NONE for the terminal's own), its tile's light, whether it glows, the glyph of someone drawn there (if anyone). */
interface Cell { ch: string; fg: RGB; bg: RGB; bold: boolean; light: Light; glow: boolean; depth: number; floor: number; being: string }

const NONE = -1;
const FULL: Light = { r: 1, g: 1, b: 1 };
const INK = rgbOf("#121016");
/** People and built things keep this much light in the dark, so they stay findable. */
const BEING_FLOOR = 0.42, BLOCK_FLOOR = 0.26;

/** Where a tile lands on the projected plane (before the camera). */
export const project = (t: Tile2) => ({ col: 2 * (t.x + t.y), row: t.y - t.x });

/** The camera transform: how projected columns and rows map to the viewport. */
function origin(camera: Tile2, viewport: Viewport) {
  const p = project(camera);
  // A little below the middle: what stands behind you (up the screen) has height, what's in front doesn't.
  return { ox: Math.floor(viewport.w / 2) - p.col, oy: Math.floor(viewport.h * 0.56) - p.row };
}

/** A tile's centre cell in the viewport. */
export function screenOf(tile: Tile2, camera: Tile2, viewport: Viewport): { x: number; y: number } {
  const { ox, oy } = origin(camera, viewport), p = project(tile);
  return { x: p.col + ox, y: p.row + oy };
}

/**
 * The ground tile under a viewport cell (for mouse picking). On each row tile centres are four
 * columns apart: a cell is a centre, just right of one, just left of the next, or the vertex
 * between two, which belongs to the tile above it (the cell under that tile's middle).
 */
export function tileAtScreen(sx: number, sy: number, camera: Tile2, viewport: Viewport): Tile2 {
  const { ox, oy } = origin(camera, viewport);
  const col = sx - ox, row = sy - oy;
  const mod4 = (n: number) => ((n % 4) + 4) % 4;
  const off = mod4(col - 2 * row);
  const [c, r] = off === 0 ? [col, row] : off === 1 ? [col - 1, row] : off === 3 ? [col + 1, row] : [col, row - 1];
  const s = c / 2;
  return { x: (s - r) / 2, y: (s + r) / 2 };
}

/** Where a region's world (0, 0) feet sits, in tiles. */
const originOf = (region: Region): Tile2 => region.worldOrigin ?? { x: region.rect.x, y: region.rect.y };

/** A point in a region's world (feet, z feet up) on the projected plane: continuous, so a tile's centre lands on its centre cell. */
function planeOf(o: Tile2, p: { x: number; y: number }, z = 0): { col: number; row: number } {
  const u = o.x + p.x / 5 - 0.5, v = o.y + p.y / 5 - 0.5;
  return { col: 2 * (u + v), row: v - u - z / 2.5 };
}

/** The ground (feet, in a region's world) under a cell of the projected plane. */
function feetOf(o: Tile2, col: number, row: number): { x: number; y: number } {
  const u = (col / 2 - row) / 2, v = (col / 2 + row) / 2;
  return { x: (u - o.x + 0.5) * 5, y: (v - o.y + 0.5) * 5 };
}

/** Which way the river runs on each map (in tiles): the town's and the Heron's downriver to the east. */
const RIVER: Record<string, Tile2> = { caerwyn: { x: 1, y: 0 }, heron: { x: 1, y: 0 }, "drowned-rat": { x: 0, y: 1 } };

const MAX_HEIGHT = 6;

export function render(map: TileMap, actors: MapActor[], camera: Tile2, viewport: Viewport, options: RenderOptions = {}): StyledLine[] {
  const { w, h } = viewport;
  const text = options.color === false;
  const asked = options.glyphs ?? glyphSet();
  // Plain text keeps to single-width glyphs: no icons.
  const set: GlyphSet = text && (asked === "nerd" || asked === "kingmaker") ? "ascii" : asked;
  const plain = set === "plain";
  const t = text ? 0 : options.t ?? (options.tick ?? 0) * 100;
  const lf: LookFrame = { t, time: options.time ?? "afternoon", glyphs: set };
  // The beat of the map's own flickers (burning roofs and trees), about nine a second.
  const beat = Math.floor(t / 110);
  const fx = text ? undefined : options.effects;
  const shake = fx?.frame.shake ?? { dx: 0, dy: 0 };
  const base = origin(camera, viewport);
  const ox = base.ox + shake.dx, oy = base.oy + shake.dy;
  const blank = (): Cell => ({ ch: " ", fg: NONE, bg: NONE, bold: false, light: FULL, glow: false, depth: -1e9, floor: 0, being: "" });
  const cells: Cell[][] = Array.from({ length: h }, () => Array.from({ length: w }, blank));
  const focus = options.focus ?? camera;
  const open = opening(map, focus, options);
  // A lamp under a roof that's on lights nothing outside it (and not the roof).
  const shut = (p: Tile2) => isRoofed(tileAt(map, p)) && options.roofs !== false && !open.lifted.has(key(p));
  const slopes = roofSlopes(map);
  const regionStates = options.regionStates ?? {};
  const index = (p: Tile2) => p.y * map.width + p.x;
  const fires = new Set((options.hazards?.fire ?? []).map(index)), dusts = new Set((options.hazards?.dust ?? []).map(index)), scorched = new Set((options.hazards?.scorched ?? []).map(index));

  // How things look this frame (once each: lights and painting both ask).
  const looks = new Map<MapActor, ActorLook>();
  const lookFor = (a: MapActor) => { let l = looks.get(a); if (!l) { l = actorLook(a, lf); looks.set(a, l); } return l; };

  // The scene worlds' surfaces, each with the tiles its world covers.
  const layers = (options.worlds ?? []).map(({ region, world }) => {
    const o = originOf(region);
    const root = world.entities[world.root]?.rect ?? { x: 0, y: 0, w: region.rect.w * 5, h: region.rect.h * 5 };
    const box = { x0: o.x + Math.floor(root.x / 5) - 1, y0: o.y + Math.floor(root.y / 5) - 1, x1: o.x + Math.ceil((root.x + root.w) / 5) + 1, y1: o.y + Math.ceil((root.y + root.h) / 5) + 1 };
    return { o, box, layer: surfaceLayer(world, lf) };
  }).filter(l => l.layer.surfaces.length || (!text && l.layer.clouds.length));
  const effects = fx ? { o: originOf(fx.region), frame: fx.frame } : undefined;

  // What burns (things, tiles): embers and smoke rise off it once everything is painted.
  const burning: Array<{ sc: number; sr: number; seed: number; strength: number; flame: FlameName }> = [];

  // The tile currently being painted: cells it touches take its light and depth.
  let light: Light = FULL, depth = 0;
  // Where the player was drawn: if something in front painted over them, they're drawn through it.
  let me: { x: number; y: number; depth: number; at: Tile2; actor: MapActor } | undefined;
  // Whose each cell is (the tile being painted, and who or what on it): for the mouse, and the pointer's highlight.
  const owner = new Int32Array(w * h).fill(-1);
  const drawn: Array<MapActor | undefined> | undefined = options.pick ? new Array(w * h) : undefined;
  let tile = -1, actor: MapActor | undefined;
  const put = (sx: number, sy: number, ch: string, fg: string | RGB, bg?: string | RGB, extra: { bold?: boolean; glow?: boolean; floor?: number; being?: boolean } = {}) => {
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const cell = cells[sy]![sx]!;
    cell.ch = plain ? inSet(ch, "plain") : ch;
    cell.fg = typeof fg === "string" ? (fg ? rgbOf(fg) : NONE) : fg;
    if (bg !== undefined) cell.bg = typeof bg === "string" ? (bg ? rgbOf(bg) : NONE) : bg;
    cell.bold = !!extra.bold; cell.glow = !!extra.glow; cell.light = light; cell.depth = depth; cell.floor = extra.floor ?? 0;
    cell.being = extra.being ? cell.ch : "";
    owner[sy * w + sx] = tile;
    if (drawn) drawn[sy * w + sx] = actor;
  };
  /** A cell as the look layer takes one (hex), for laying something over it. */
  const under = (sx: number, sy: number) => { const c = cells[sy]![sx]!; return { glyph: c.ch, fg: hexOf(c.fg === NONE ? INK : c.fg), bg: hexOf(c.bg === NONE ? INK : c.bg) }; };

  const marks = new Map((options.marks ?? []).map(m => [key(m.at), m]));
  /** A tinted tile: its floor takes the mark's colour (it isn't darkened at night: you need to see it). */
  const paintMark = (m: { color: string; glyph?: string }, sc: number, sr: number) => {
    for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [0, 1]] as const) {
      const sx = sc + dx, sy = sr + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const cell = cells[sy]![sx]!;
      cell.bg = mixRGB(cell.bg === NONE ? rgbOf("#101014") : cell.bg, rgbOf(m.color), 0.45); cell.glow = true;
    }
    if (m.glyph) put(sc, sr, m.glyph, m.color, undefined, { bold: true, glow: true });
  };
  const byTile = new Map<string, MapActor[]>();
  // A door in the scene's world says how its door tile looks (open, shut, barred); it isn't drawn itself.
  const doors = new Map<string, string[]>();
  for (const a of actors) if (a.map === map.id) {
    const k = key(a.at);
    if (tileAt(map, a.at).terrain === "door" && a.kind === "object" && isDoorThing(a)) { doors.set(k, a.states ?? []); continue; }
    byTile.set(k, [...(byTile.get(k) ?? []), a]);
  }
  const lights = text ? undefined : lighting(map, options, open, sources(), (x, y) => {
    const tile = tileAt(map, { x, y });
    if (!tile.opaque) return true;
    const states = doors.get(`${x},${y}`);
    return !!states && (states.includes("open") || states.includes("destroyed"));
  });

  /** What lights the map this frame: lamps and fires (the look's), burning patches, effects, a fight's fire, windows. */
  function sources(): Source[] {
    const out: Source[] = [];
    const add = (x: number, y: number, radius: number, color: string | RGB, intensity: number, how: Partial<Pick<Source, "through" | "indoors" | "ground">> = {}) => {
      const c = typeof color === "string" ? rgbOf(color) : color;
      if (radius > 0.3 && intensity > 0.02) out.push({ x, y, radius, r: ((c >> 16) & 255) / 255 * intensity, g: ((c >> 8) & 255) / 255 * intensity, b: (c & 255) / 255 * intensity, ...how });
    };
    for (const a of actors) {
      if (a.map !== map.id || shut(a.at)) continue;
      const l = lookFor(a).light;
      if (l) add(a.at.x, a.at.y, l.radius, l.color, l.intensity);
    }
    for (const { o, layer } of layers) for (const l of layer.lights) add(o.x + l.x / 5 - 0.5, o.y + l.y / 5 - 0.5, l.radius / 5, l.color, l.intensity);
    if (effects) for (const l of effects.frame.lights) add(effects.o.x + l.x / 5 - 0.5, effects.o.y + l.y / 5 - 0.5, l.radius / 5, l.color, l.intensity);
    for (const i of fires) add(i % map.width, Math.floor(i / map.width), 2.6, "#ff8a3c", 0.75 + 0.2 * noise2(i, t / 140, 5));
    for (const [id, states] of Object.entries(regionStates)) {
      if (!states.includes("burning")) continue;
      const region = map.regions.find(r => r.id === id) as PlaceRegion | undefined;
      // A building on fire lights the street over its walls: the flames are through the roof.
      if (region) add(region.rect.x + region.rect.w / 2, region.rect.y + region.rect.h / 2, Math.max(region.rect.w, region.rect.h), "#ff8a3c", 1.1 + 0.2 * noise2(t / 150, 3, 7), { through: true });
    }
    // Lit windows spill a little light into the street at night; by day they light the room behind them.
    const night = options.time === "night" || options.time === "evening";
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.tiles[y]![x]!.terrain !== "window") continue;
      if (night) add(x, y, 2.4, WINDOW_LIGHT.night, 0.55, { ground: true });
      else add(x, y, 3.2, WINDOW_LIGHT.day, 0.38, { indoors: true, ground: true });
    }
    return out;
  }

  // Back to front: rows of the projected plane, top of the screen first (a raised block's base can
  // be below the bottom edge and still reach up into view).
  const rowFrom = -oy - 2, rowTo = h - oy + MAX_HEIGHT + 2;
  for (let R = rowFrom; R <= rowTo; R++) {
    const sMin = Math.ceil((-4 - ox) / 2), sMax = Math.floor((w + 4 - ox) / 2);
    for (let S = sMin; S <= sMax; S++) {
      if (((S - R) % 2 + 2) % 2) continue;
      const x = (S - R) / 2, y = (S + R) / 2;
      const at = { x, y };
      if (!inBounds(map, at)) continue;
      const t = tileAt(map, at);
      if (t.terrain === "void") continue;
      const sc = 2 * S + ox, sr = R + oy;
      light = lights?.at(x, y) ?? FULL; depth = R;
      tile = index(at); actor = undefined;
      const region = regionAt(map, at);
      const states = region ? regionStates[region.id] ?? [] : [];
      paintTile(at, t, sc, sr, states);
      const mark = marks.get(key(at));
      if (mark) paintMark(mark, sc, sr);
      for (const a of order(byTile.get(key(at)) ?? [])) { actor = a; paintActor(a, t, at, sc, sr); }
      actor = undefined;
      if (options.cursor && options.cursor.x === x && options.cursor.y === y) {
        const glow = { bold: true, glow: true };
        put(sc - 1, sr, "[", "#ffe680", undefined, glow); put(sc + 1, sr, "]", "#ffe680", undefined, glow);
      }
    }
  }

  function paintTile(at: Tile2, t: MapTile, sc: number, sr: number, states: string[]): void {
    const { x, y } = at;
    const burnt = states.includes("exploded") || states.includes("burnt") || states.includes("scorched") || scorched.has(index(at));
    const burning = states.includes("burning");
    if (t.terrain === "tree") {
      ground(at, groundKey(t), sc, sr);
      put(sc, sr, "│", TREE.trunk);
      const canopy = burning ? FIRE[hash(x, y, beat) % 4]! : TREE.canopy;
      for (const dx of [-1, 0, 1]) put(sc + dx, sr - 1, pick(TREE.canopyChars, x, y, dx), leaves(at, dx, -1), canopy);
      put(sc, sr - 2, "♣", leaves(at, 0, -2), canopy);
      if (burning) lightUp(sc, sr - 1);
      return;
    }
    const roofed = isRoofed(t);
    const raised = isStructure(t) || roofed;
    if (!raised) {
      ground(at, burnt ? "scorched" : groundKey(t), sc, sr);
      if (burning && hash(x, y, beat >> 1) % 3 === 0) { put(sc + (hash(x, y) % 3) - 1, sr, pick("^*▲", x, y, beat), FIRE[hash(x, y, beat) % 4]!, undefined, { glow: true }); }
      return;
    }
    const style = BLOCKS[burnt ? "burnt" : blockStyle(t)] ?? BLOCKS.stone!;
    const k = key(at);
    if (roofed && (open.lifted.has(k) || options.roofs === false)) { ground(at, burnt ? "scorched" : groundKey(t), sc, sr); return; }
    if (open.cut.has(k)) {
      ground(at, groundKey(t), sc, sr);
      if (roofed) return;
      // A front wall cut down to a stub, a section through the room; a doorway stays open.
      if (t.terrain === "door") {
        put(sc, sr, "▯", "#c08a50", undefined, { floor: BLOCK_FLOOR });
        return;
      }
      block(at, style, 1, sc, sr);
      return;
    }
    const height = Math.max(1, Math.min(MAX_HEIGHT, (roofed ? t.roofHeight ?? 3 : t.height) ?? 1));
    if (t.terrain === "door" && height <= 1) {
      // A gate in a low wall: two posts, and the gate itself when it's shut.
      ground(at, groundKey(t), sc, sr);
      const post = { floor: BLOCK_FLOOR };
      put(sc - 1, sr - 1, "▄", style.top, undefined, post); put(sc - 1, sr, "█", style.west, undefined, post);
      put(sc + 1, sr - 1, "▄", style.top, undefined, post); put(sc + 1, sr, "█", style.south, undefined, post);
      const shut = !(doors.get(key(at)) ?? ["open"]).includes("open") || !!t.blocks;
      if (shut) put(sc, sr, "╪", "#9a6436", undefined, post);
      return;
    }
    block(at, style, height, sc, sr);
    if (t.terrain === "door") door(at, t, height, sc, sr);
    if (t.terrain === "window") windows(at, height, sc, sr);
    if (burning) for (const dx of [-1, 0, 1]) if (hash(x, y, dx, beat) % 2) put(sc + dx, sr - height - (hash(x, y, dx) % 2), pick("^*▲", x, y, dx, beat), FIRE[hash(x, y, dx, beat) % 4]!, undefined, { glow: true });
  }

  /** Leaves in the wind: gusts run through the canopies, lighting them as they go. */
  function leaves(at: Tile2, dx: number, dy: number): RGB {
    const p = project(at);
    const gust = text ? 0 : Math.max(0, noise2((p.col + dx) * 0.07 - t / 900, (p.row + dy) * 0.3, 97) - 0.55) / 0.45;
    return mixRGB(rgbOf(TREE.canopyFg), rgbOf("#9cc864"), gust * 0.65);
  }

  /**
   * The ground of a tile: its three face cells and the cell under its middle, alive (the look's
   * living terrain, in projected-plane coordinates so it doesn't crawl with the camera), then
   * whatever lies on it (a scene world's puddles and slicks), burns on it or hangs over it.
   */
  function ground(at: Tile2, kind: string, sc: number, sr: number): void {
    const look = GROUND[kind]!;
    if (!look.bg) return;
    const p = project(at);
    const i = index(at);
    const fire = fires.has(i), dust = dusts.has(i);
    const flow = kind === "water" || kind === "deep-water" ? flowOf(kind) : undefined;
    const indoors = isRoofed(tileAt(map, at));
    // Only the layers with something near this tile.
    const near = layers.filter(l => at.x >= l.box.x0 && at.x <= l.box.x1 && at.y >= l.box.y0 && at.y <= l.box.y1 && l.layer.surfaces.some(sp => {
      const f = feetOf(l.o, p.col, p.row);
      return Math.hypot(f.x - sp.x, f.y - sp.y) < sp.radius + 5;
    }));
    for (let c = 0; c < 4; c++) {
      const dx = c < 3 ? c - 1 : 0, dy = c === 3 ? 1 : 0;
      const sx = sc + dx, sy = sr + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const px = p.col + dx, py = p.row + dy;
      const cell = text ? undefined : groundAt(kind, px, py, lf, flow);
      if (cell) {
        // The lattice: the cell under a tile's middle keeps a faint dot, so the grid reads.
        if (dy && cell.glyph === " " && look.tip !== " " && !look.animate) put(sx, sy, look.tip, hexOf(mixRGB(rgbOf(cell.bg!), rgbOf(cell.fg), 0.55)), cell.bg);
        else put(sx, sy, cell.glyph, cell.fg, cell.bg);
      } else if (dy) {
        put(sx, sy, look.animate && (hash(at.x, at.y) + beat) % 3 === 0 ? " " : look.tip, look.fg, look.bg);
      } else {
        const faces = [...look.face];
        const f = look.animate ? (hash(at.x, at.y) + dx + 1 + beat) % faces.length : hash(at.x, at.y, dx) % faces.length;
        put(sx, sy, faces[f]!, look.fg2 && hash(at.x, at.y, dx, 7) % 4 === 0 ? look.fg2 : look.fg, look.bg);
      }
      for (const l of near) {
        const over = l.layer.at(feetOf(l.o, px, py), under(sx, sy), px, py, indoors);
        if (over) put(sx, sy, over.glyph, over.fg, over.bg, { ...(over.glow ? { glow: true } : {}) });
      }
      if (fire) { const f = fireAt(under(sx, sy), px, py, lf, 0.8, i); put(sx, sy, f.glyph, f.fg, f.bg, { bold: true, ...(f.glow ? { glow: true } : {}) }); }
      if (dust && !text) { const d = dustAt(under(sx, sy), px, py, lf); put(sx, sy, d.glyph, d.fg, d.bg); }
    }
    // Flames lick up off a burning tile.
    if (fire) {
      burning.push({ sc, sr, seed: i, strength: 0.35, flame: "fire" });
      const heat = noise2(i * 0.37, t / 160, 11);
      if (heat > 0.45) put(sc + (hash(at.x, at.y, beat >> 2) % 3) - 1, sr - 1, heat > 0.7 ? "▲" : "^", hexOf(mixRGB(rgbOf("#ff7a10"), rgbOf("#ffe680"), heat - 0.45)), undefined, { bold: true, glow: true });
    }
  }

  /** The river's current on the projected plane (square units a second), from which way it runs on this map. */
  function flowOf(kind: string): { x: number; y: number } {
    const d = RIVER[map.id] ?? { x: 1, y: 0 };
    const col = 2 * (d.x + d.y), row = 2 * (d.y - d.x);
    const k = (kind === "deep-water" ? 1.5 : 0.7) / Math.max(1e-6, Math.hypot(col, row));
    return { x: col * k, y: row * k };
  }

  function block(at: Tile2, s: BlockLook, height: number, sc: number, sr: number): void {
    const { x, y } = at;
    const top = sr - height;
    const struct = { floor: BLOCK_FLOOR };
    // Roofs are two slopes and a ridge: the north and west slopes catch the light.
    const slope = slopes[y * map.width + x]!;
    const k = slope === 1 ? 1.14 : slope === 2 ? 1.3 : slope === 3 ? 0.8 : 1;
    const roof = k === 1 ? s.top : scale(s.top, k), roofFg = k === 1 ? s.topFg : scale(s.topFg, k);
    const chars = slope === 2 ? "▀" : s.topChars;
    for (const dx of [-1, 0, 1]) put(sc + dx, top, pick(chars, x, y, dx), slope === 2 ? scale(s.topFg, 1.45) : roofFg, roof, struct);
    put(sc, top + 1, pick(chars, x, y, 9), slope === 2 ? scale(s.topFg, 1.45) : roofFg, roof, struct);
    for (let r = top + 1; r <= sr; r++) {
      const course = r - top;
      put(sc - 1, r, s.faceChars ? pick(s.faceChars, x, y, course) : " ", s.faceFg ?? s.west, s.west, struct);
      put(sc + 1, r, s.faceChars ? pick(s.faceChars, y, x, course) : " ", s.faceFg ?? s.south, s.south, struct);
      if (r > top + 1) put(sc, r, " ", s.edge, s.edge, struct);
    }
    put(sc, sr + 1, " ", s.edge, s.edge, struct);
  }

  /** A door on whichever face it opens through: planks when shut (darker when barred), a dark gap when open. */
  function door(at: Tile2, t: MapTile, height: number, sc: number, sr: number): void {
    const through = passable(map, { x: at.x, y: at.y - 1 }) || passable(map, { x: at.x, y: at.y + 1 }) ? "south" : "west";
    const states = doors.get(key(at)) ?? [];
    const open = states.includes("open") || states.includes("destroyed");
    const locked = !open && (!!t.blocks || states.some(s => s === "locked" || s === "barred" || s === "bolted"));
    const colour = open ? "#1a1410" : locked ? "#6b3f1e" : "#9a6436";
    const col = through === "south" ? sc + 1 : sc - 1;
    const struct = { floor: BLOCK_FLOOR };
    for (let r = sr - Math.min(2, height - 1); r <= sr; r++) put(col, r, open ? " " : r === sr ? "▙" : "█", colour, scale(colour, 0.6), struct);
    put(sc, sr + 1, "▀", colour, scale(colour, 0.5), struct);
  }

  function windows(at: Tile2, height: number, sc: number, sr: number): void {
    const night = options.time === "night" || options.time === "evening";
    const glass = night ? "#ffcf6b" : "#9fc4dc";
    const r = sr - Math.max(1, Math.floor(height / 2));
    const southFacing = passable(map, { x: at.x, y: at.y + 1 });
    put(southFacing ? sc + 1 : sc - 1, r, "▪", glass, undefined, { glow: night, floor: BLOCK_FLOOR });
  }

  /**
   * Someone or something on a tile, as the look layer has them this frame: the cast by their
   * letters, things by the rules from their names and states (burning things flicker with flames
   * licking up, smashed ones are splinters, the hidden are faint, the fallen dim), the map's own
   * decor as authored. The player keeps their highlight; bunting and a hanged man's rope stay.
   */
  function paintActor(a: MapActor, t: MapTile, at: Tile2, sc: number, sr: number): void {
    const k = key(at);
    const roofedOver = isRoofed(t) && options.roofs !== false && !open.lifted.has(k);
    if (roofedOver && a.kind !== "player") return;
    // Standing on a wall top (Moll on the yard wall) unless the wall is cut down.
    const standing = isStructure(t) && t.blocks && !open.cut.has(k) ? Math.max(0, t.height ?? 0) : 0;
    const states = a.states ?? [];
    if (a.kind === "player") {
      const r = sr - standing - raiseFor(a.name, states);
      // Out of sight (hidden), you're greyer, and you don't shine.
      if (states.includes("hidden")) put(sc, r, "@", "#8c96a6", "#1e2026", { bold: true });
      else put(sc, r, "@", a.color ?? "#d0d0d0", "#3a3418", { bold: true, glow: true });
      me = { x: sc, y: r, depth, at, actor: a };
      return;
    }
    const look = lookFor(a);
    // Hidden from the player, or gone.
    if (look.alpha < 0.35) return;
    // The map's own height where it has one (a hanged man under his beam, the beam above him), else the
    // look's (a bird on the wing); up a post (a lamp, a sign), a row up, the post under it, and people walk past.
    const post = states.includes("post");
    const r = sr - standing - Math.max(raiseFor(a.name, states) || look.lift, post ? 1 : 0);
    if (states.includes("overhead")) {
      // Bunting and the like: a string of little flags across the tile.
      for (const dx of [-1, 0, 1]) put(sc + dx, r, dx ? a.glyph : "‿", dx ? bunting(at, dx) : "#8a8070");
      return;
    }
    // A rope up to whatever it hangs from.
    if (states.includes("hanging")) put(sc, r - 1, "│", "#c8a878");
    if (post) put(sc, r + 1, "│", scaleRGB(rgbOf(look.fg), 0.5), undefined, { floor: BLOCK_FLOOR });
    const person = a.kind === "person" || a.kind === "creature";
    // Big and in the way: it fills its square, so it looks as big as it is.
    const big = a.blocks && !person && !look.look.wreck && look.alpha >= 1 ? bulk(a, look) : undefined;
    if (big) for (const p of big.parts) put(sc + p.dx, r + p.dy, p.ch, p.fg, undefined, { floor: BLOCK_FLOOR, ...(p.bold ? { bold: true } : {}) });
    const gy = r - (big?.lift ?? 0);
    const fg = look.alpha < 1 && gy >= 0 && gy < h && sc >= 0 && sc < w ? mixRGB(cells[gy]![sc]!.bg === NONE ? INK : cells[gy]![sc]!.bg, rgbOf(look.fg), look.alpha) : look.fg;
    // What burns throws embers and smoke; a big thing on fire (a table, a stack of sacks) burns
    // over its whole tile, tongues of flame licking up off it, each on its own beat.
    const heat = look.look.burning ?? 0, flame = look.look.flame ?? "fire";
    if (heat > 0) burning.push({ sc, sr: r, seed: seedOf(a.id), strength: heat, flame });
    if (heat > 0 && !person && (a.blocks || look.look.wreck)) {
      const p = project(at);
      for (const dx of [-1, 1]) {
        if (sc + dx >= 0 && sc + dx < w && r >= 0 && r < h) {
          const f = fireAt(under(sc + dx, r), p.col + dx, p.row, lf, 0.55 + 0.4 * heat, seedOf(a.id), flame);
          put(sc + dx, r, f.glyph, f.fg, f.bg, { bold: true, ...(f.glow ? { glow: true } : {}) });
        }
        const tongue = noise2(beat * 0.37 + dx * 3.1, seedOf(a.id) % 97, 13);
        if (tongue > 0.5) put(sc + dx, r - 1, tongue > 0.75 ? "▲" : "^", ramp(FLAME_RAMPS[flame], clamp01(0.45 + tongue * 0.5)), undefined, { bold: true, glow: true });
      }
    }
    // Sacks and crates come in stacks (unless their bulk already fills the square).
    const stacked = !big && !look.look.wreck && (look.glyph === "■" || look.glyph === "▣" || (!!a.blocks && STACKS.has(look.look.role)));
    if (stacked) { put(sc, gy - 1, look.glyph, scaleRGB(rgbOf(look.fg), 1.1), undefined, { floor: BLOCK_FLOOR }); put(sc + (hash(at.x, at.y) % 2 ? 1 : -1), gy, look.glyph, scaleRGB(rgbOf(look.fg), 0.85), undefined, { floor: BLOCK_FLOOR }); }
    // Someone you can see stays findable in any light (the light pass's shadeBeing); the hidden stay faint.
    const being = person && look.alpha >= 1;
    put(sc, gy, look.glyph, fg, look.bg, { bold: !!look.bold, glow: look.glow, floor: person ? BEING_FLOOR : 0, being });
    // The fallen have a mark at their feet, so they don't pass for the standing.
    if (person && states.some(s => FALLEN.has(s))) put(sc + 1, gy, "_", fg, undefined, { floor: BEING_FLOOR, being });
    if (look.above) put(sc, gy - (stacked || big?.parts.some(p => p.dx === 0 && p.dy === -1) ? 2 : 1), look.above.glyph, look.above.fg, undefined, { bold: true, glow: true });
  }

  /** Something burning lights the cell it's in and stays bright at night. */
  function lightUp(sx: number, sy: number): void {
    if (sx >= 0 && sy >= 0 && sx < w && sy < h) cells[sy]![sx]!.glow = true;
  }

  if (!text) for (const b of burning) rise(b);

  /**
   * Embers and smoke off something burning, the stage's way: a particle a beat, where it goes and
   * whether it's born at all decided by a hash, so any frame is exact. Embers rise and wink out;
   * smoke rises higher and drifts downwind (east, up the screen to the right), veiling what's there.
   */
  function rise(b: { sc: number; sr: number; seed: number; strength: number; flame: FlameName }): void {
    const beats = (period: number, life: number, each: (j: number, age: number, f: number) => void) => {
      for (let j = Math.floor((t - life) / period); j <= Math.floor(t / period); j++) {
        const age = t - j * period;
        if (age >= 0 && age <= life) each(j, age, age / life);
      }
    };
    const flames = FLAME_RAMPS[b.flame];
    beats(150, 950, (j, age, f) => {
      if (hash01(b.seed, j, 1) > 0.45 * b.strength + 0.15) return;
      const x = b.sc + Math.round((hash01(b.seed, j, 2) - 0.5) * 3 + f * 1.4 + Math.sin(age / 170 + j) * 0.5);
      const y = b.sr - 1 - Math.round((age / 1000) * (2 + hash01(b.seed, j, 3) * 3));
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const cell = cells[y]![x]!;
      cell.ch = plain ? "." : f < 0.3 ? "*" : f < 0.6 ? "'" : "·";
      cell.fg = ramp(flames, clamp01(0.95 - f * 0.7));
      if (cell.bg === NONE) cell.bg = INK;
      cell.glow = true;
    });
    beats(260, 2600, (j, age, f) => {
      if (hash01(b.seed, j, 4) > 0.55 * b.strength + 0.1) return;
      const x = b.sc + Math.round((hash01(b.seed, j, 5) - 0.5) * 2 + f * 4 + noise2(age / 600, j, b.seed) * 2 - 1);
      const y = b.sr - 2 - Math.round((age / 1000) * (1.4 + hash01(b.seed, j, 6) * 1.2));
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const cell = cells[y]![x]!;
      if (cell.bg === NONE) return;
      const k = (1 - f) * 0.5;
      cell.bg = mixRGB(cell.bg, rgbOf("#4a4650"), k);
      cell.fg = mixRGB(cell.fg === NONE ? cell.bg : cell.fg, rgbOf("#8a8690"), k * 0.8);
      if (k > 0.28 && !cell.glow) cell.ch = plain ? ":" : f < 0.3 ? "▒" : "░";
    });
  }

  // Effects over the place: what's on the ground and in the air, then shockwaves, fireballs, flashes.
  if (effects) {
    const { o, frame } = effects;
    for (const sp of [...frame.sprites].sort((a, b) => a.layer - b.layer)) {
      const p = planeOf(o, sp, sp.z);
      const sx = Math.round(p.col) + ox, sy = Math.round(p.row) + oy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const cell = cells[sy]![sx]!;
      const bg = cell.bg === NONE ? INK : cell.bg;
      if (sp.bg !== undefined) {
        // Translucent (smoke, steam, dust): it veils the cell; only the thicker part of a puff draws its wisp.
        const k = (sp.bgAlpha ?? 0.5) * sp.alpha;
        cell.bg = mixRGB(bg, sp.bg, k);
        if (k > 0.18) { cell.ch = plain ? inSet(sp.glyph, "plain") : sp.glyph; cell.fg = mixRGB(cell.bg, sp.fg, Math.min(1, k * 2.2)); }
        else cell.fg = mixRGB(cell.fg === NONE ? bg : cell.fg, sp.fg, k);
      } else {
        cell.ch = plain ? inSet(sp.glyph, "plain") : sp.glyph;
        cell.fg = sp.alpha < 1 ? mixRGB(bg, sp.fg, sp.alpha) : sp.fg;
        if (cell.bg === NONE) cell.bg = INK;
      }
      if (sp.glow) cell.glow = true;
    }
    for (const area of frame.areas) {
      const c = planeOf(o, area);
      const reach = (area.radius + area.width) / 5;
      const cols = Math.ceil(reach * 2.9) + 1, rows = Math.ceil(reach * 1.5) + 1;
      for (let sy = Math.round(c.row) + oy - rows; sy <= Math.round(c.row) + oy + rows; sy++) for (let sx = Math.round(c.col) + ox - cols; sx <= Math.round(c.col) + ox + cols; sx++) {
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const f = feetOf(o, sx - ox, sy - oy);
        const a = areaCell(area, f.x, f.y, t);
        if (!a) continue;
        const cell = cells[sy]![sx]!;
        if (a.glyph) cell.ch = plain ? inSet(a.glyph, "plain") : a.glyph;
        cell.fg = mixRGB(cell.fg === NONE ? INK : cell.fg, a.fg, a.mixFg);
        if (a.bg !== undefined) cell.bg = mixRGB(cell.bg === NONE ? INK : cell.bg, a.bg, a.mixBg);
        if (a.glow) cell.glow = true;
      }
    }
  }

  // Smoke and steam over everything, drifting.
  if (!text) for (const { o, box, layer } of layers) {
    if (!layer.clouds.length) continue;
    for (const cl of layer.clouds) {
      const c = planeOf(o, cl);
      const reach = (cl.radius * 1.4) / 5;
      const cols = Math.ceil(reach * 2.9) + 1, rows = Math.ceil(reach * 1.5) + 2;
      for (let sy = Math.round(c.row) + oy - rows; sy <= Math.round(c.row) + oy + rows; sy++) for (let sx = Math.round(c.col) + ox - cols; sx <= Math.round(c.col) + ox + cols; sx++) {
        if (sx < 0 || sy < 0 || sx >= w || sy >= h || cells[sy]![sx]!.bg === NONE) continue;
        const f = feetOf(o, sx - ox, sy - oy);
        const tx = o.x + Math.floor(f.x / 5), ty = o.y + Math.floor(f.y / 5);
        if (tx < box.x0 || tx > box.x1 || ty < box.y0 || ty > box.y1) continue;
        const veil = layer.cloud(f, under(sx, sy));
        if (!veil) continue;
        const cell = cells[sy]![sx]!;
        cell.ch = plain ? inSet(veil.glyph, "plain") : veil.glyph; cell.fg = rgbOf(veil.fg); cell.bg = rgbOf(veil.bg!);
      }
    }
  }

  // Hidden behind a building: drawn through it, picked out so it's plain that you're back there.
  if (me && me.x >= 0 && me.y >= 0 && me.x < w && me.y < h && cells[me.y]![me.x]!.depth > me.depth) {
    depth = 1e9; light = FULL; tile = index(me.at); actor = me.actor;
    put(me.x, me.y, "@", "#ffffff", "#6a3a8a", { bold: true, glow: true });
    actor = undefined;
  }

  // The pointer's tile, lit up: everything drawn for it (its ground, a wall's face, a lamp up its post).
  if (options.hover && !text && inBounds(map, options.hover)) {
    const hovered = index(options.hover);
    for (let i = 0; i < w * h; i++) {
      if (owner[i] !== hovered) continue;
      const cell = cells[Math.floor(i / w)]![i % w]!;
      cell.bg = mixRGB(cell.bg === NONE ? INK : cell.bg, HOVER, 0.3);
      cell.glow = true;
    }
  }

  // The lead: a marker floating over the place the story is heading for, or an arrow at the edge.
  if (options.lead) {
    const s = screenOf(options.lead, camera, viewport);
    const t = tileAt(map, options.lead);
    const standing = isStructure(t) && t.blocks ? t.height ?? 0 : 0;
    const my = s.y - 2 - standing;
    const pulse = Math.floor(lf.t / 450) % 2 === 0;
    depth = 1e9; light = FULL; tile = inBounds(map, options.lead) ? index(options.lead) : -1; actor = undefined;
    if (s.x >= 1 && s.x < w - 1 && my >= 0 && my < h) {
      put(s.x, my, pulse ? "▼" : "▽", "#ffd700", undefined, { bold: true, glow: true });
      if (my - 1 >= 0) put(s.x, my - 1, "!", "#ffd700", undefined, { bold: true, glow: true });
    } else {
      edgeArrow(s.x, my, options.leadLabel);
    }
  }

  function edgeArrow(tx: number, ty: number, label?: string): void {
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const dx = tx - cx, dy = (ty - cy) * 2;
    const k = Math.min(dx ? (w / 2 - 2) / Math.abs(dx) : Infinity, dy ? (h - 2) / Math.abs(dy) : Infinity);
    const ax = Math.round(cx + dx * k), ay = Math.round(cy + (dy * k) / 2);
    const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
    const arrow = arrows[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8]!;
    const text = `${arrow}${label ? ` ${label}` : ""}`;
    const start = Math.max(0, Math.min(w - [...text].length, dx < 0 ? ax : ax - [...text].length + 1));
    [...text].forEach((ch, i) => put(start + i, Math.max(0, Math.min(h - 1, ay)), ch, "#ffd700", undefined, { bold: true, glow: true }));
  }

  // The light: daylight by the time of day (dimmer in a room you can see into), and whatever is lit
  // near each tile, coloured, falling off softly and stopped by walls. What glows stays bright, and
  // people (still showing: nothing drew over them since) keep their colour and stay findable.
  if (!text) for (const row of cells) for (const cell of row) {
    if (cell.glow) continue;
    const l = cell.light;
    if (cell.bg !== NONE) cell.bg = shadeBy(cell.bg, l.r, l.g, l.b, cell.floor * 0.7);
    if (cell.fg === NONE) continue;
    cell.fg = cell.being && cell.being === cell.ch ? shadeBeing(cell.fg, l.r, l.g, l.b, cell.floor, cell.bg === NONE ? INK : cell.bg) : shadeBy(cell.fg, l.r, l.g, l.b, cell.floor);
  }

  // Floating text last, never darkened: barks over whoever said them, damage numbers rising.
  if (effects) {
    const taken = new Uint8Array(w * h);
    const texts = [...effects.frame.texts].sort((a, b) => (a.style === "bark" ? 0 : 1) - (b.style === "bark" ? 0 : 1));
    for (const tx of texts) float(tx, effects.o, taken);
  }

  /** A bark in a dark bubble with the speaker's colour down its side, or a number rising and fading. */
  function float(tx: FloatText, o: Tile2, taken: Uint8Array): void {
    if (tx.alpha <= 0.02) return;
    const p = planeOf(o, tx);
    const cx = Math.round(p.col) + ox, cy = Math.round(p.row) + oy - 1;
    // The nearest rows (up first, then down) where a span of cells is free of other text.
    const free = (left: number, top: number, width: number, height: number): number => {
      for (const shift of [0, -1, -2, 1, -3, 2, -4]) {
        let ok = true;
        for (let y = top + shift; y < top + shift + height && ok; y++) for (let x = left; x < left + width; x++) if (x >= 0 && y >= 0 && x < w && y < h && taken[y * w + x]) { ok = false; break; }
        if (ok) return top + shift;
      }
      return top;
    };
    const claim = (left: number, top: number, width: number, height: number) => { for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) if (x >= 0 && y >= 0 && x < w && y < h) taken[y * w + x] = 1; };
    const ink = (x: number, y: number, ch: string, fg: RGB, bg?: RGB, bold = false) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const cell = cells[y]![x]!;
      cell.ch = plain ? inSet(ch, "plain") : ch; cell.fg = fg; if (bg !== undefined) cell.bg = bg; cell.bold = bold; cell.glow = true;
    };
    const body = plain ? plainText(tx.text) : tx.text;
    if (tx.style === "bark") {
      const lines = wrapBark(body, Math.max(12, Math.min(28, w - 6)));
      const width = Math.max(...lines.map(l => [...l].length)) + 3;
      const left = Math.max(0, Math.min(w - width, cx - Math.floor(width / 2)));
      const top = Math.max(0, free(left, cy - Math.round(tx.rows) - lines.length + 1, width, lines.length));
      claim(left, top, width, lines.length);
      const bubble = tx.bg ?? rgbOf("#16141c"), parchment = rgbOf("#efe6d2");
      lines.forEach((line, k) => {
        [...`▌${line.padEnd(width - 2)} `].forEach((ch, j) => {
          const x = left + j, y = top + k;
          if (x < 0 || y < 0 || x >= w || y >= h) return;
          const bg = mixRGB(cells[y]![x]!.bg === NONE ? INK : cells[y]![x]!.bg, bubble, Math.min(1, tx.alpha * 1.1));
          ink(x, y, ch, mixRGB(bg, j === 0 ? tx.fg : parchment, tx.alpha), bg);
        });
      });
      // The tail, pointing down at whoever's talking: not into another bark, and none comes over it.
      const ty = top + lines.length;
      if (ty < cy + 1 && cx >= 0 && cx < w && ty >= 0 && ty < h && !taken[ty * w + cx]) {
        ink(cx, ty, "▾", mixRGB(cells[ty]![cx]!.bg === NONE ? INK : cells[ty]![cx]!.bg, tx.fg, tx.alpha));
        taken[ty * w + cx] = 1;
      }
      return;
    }
    const chars = [...body];
    const left = Math.max(0, Math.min(w - chars.length, cx - Math.floor(chars.length / 2)));
    const y = free(left, cy - Math.round(tx.rows), chars.length, 1);
    claim(left, y, chars.length, 1);
    chars.forEach((ch, j) => {
      const x = left + j;
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const beneath = cells[y]![x]!.bg === NONE ? INK : cells[y]![x]!.bg;
      const bg = tx.style === "damage" || tx.style === "heal" || tx.style === "alert" ? mixRGB(beneath, rgbOf("#0e0c10"), 0.55 * tx.alpha) : beneath;
      ink(x, y, ch, mixRGB(bg, tx.fg, tx.alpha), bg, tx.bold);
    });
  }

  options.pick?.fill(w, h, map, owner, drawn ?? []);
  return cells.map(row => toSpans(row, !text));
}

/** Sacks, crates and grain heaped high enough to be in the way. */
const STACKS = new Set(["sack", "crate", "grain"]);
/** States that put someone on the floor. */
const FALLEN = new Set(["down", "unconscious", "dead", "prone"]);

/** The pointer's highlight. */
const HOVER = rgbOf("#9ab8e8");

const WOOD = rgbOf("#8a6a48"), WHEEL = rgbOf("#6a5038"), STONE = rgbOf("#8e8a84"), AWNING = [rgbOf("#c8483a"), rgbOf("#e8dcc0")];

/** A cell of a thing's bulk: across from (dx), or over (dy -1), the cell its own glyph would take. */
interface Part { dx: number; dy: number; ch: string; fg: RGB; bold?: boolean }

/**
 * How a big thing that's in the way fills its square, so it looks it: a cart has a wheel either
 * side (and its load on it), a stall its awning over it, the statue its plinth under it (`lift`
 * raises the thing's own glyph onto it), the crane its treadwheel, crates and sacks are a stack.
 * Anything else in the way gets a frame in its own colour.
 */
function bulk(a: MapActor, look: ActorLook): { parts: Part[]; lift: number } {
  const name = a.name.toLowerCase(), role = look.look.role, fg = rgbOf(look.fg);
  const side = (left: string, right: string, color: RGB = scaleRGB(fg, 0.62)): Part[] => [{ dx: -1, dy: 0, ch: left, fg: color }, { dx: 1, dy: 0, ch: right, fg: color }];
  const over = (chars: string, colors: RGB[]): Part[] => [...chars].map((ch, i) => ({ dx: i - 1, dy: -1, ch, fg: colors[i % colors.length]! }));
  if (/\bstalls?\b/.test(name)) return { parts: [...over("▄▄▄", AWNING), ...side("│", "│", WOOD)], lift: 0 };
  if (role === "cart" || /\b(cart|wagon|barrow)\b/.test(name)) {
    const load = /cabbage/.test(name) ? over("●●●", [rgbOf("#6aa04a"), rgbOf("#8ac060")]) : /garland/.test((a.states ?? []).join(" ")) ? over("~~~", [rgbOf("#e04040"), rgbOf("#f0c040"), rgbOf("#4080e0")]) : [];
    return { parts: [...side("o", "o", WHEEL), ...load], lift: 0 };
  }
  if (role === "statue") return { parts: [...side("▐", "▌", STONE), { dx: 0, dy: 0, ch: "█", fg: STONE }], lift: 1 };
  if (role === "well") return { parts: side("(", ")", STONE), lift: 0 };
  if (/\bstocks\b|pillory/.test(name)) return { parts: side("═", "═", fg), lift: 0 };
  if (/crane|treadwheel/.test(name)) return { parts: [...side("(", ")", WOOD), { dx: 0, dy: 0, ch: "○", fg: WOOD, bold: true }, { dx: 1, dy: -1, ch: "─", fg }], lift: 1 };
  if (STACKS.has(role) || look.glyph === "■" || look.glyph === "▣") return { parts: [...side(look.glyph, look.glyph, scaleRGB(fg, 0.85)), { dx: 0, dy: -1, ch: look.glyph, fg: scaleRGB(fg, 1.1) }], lift: 0 };
  if (role === "table" || role === "bench") return { parts: side("═", "═", fg), lift: 0 };
  if (role === "boat" || role === "hull-bar") return { parts: side("◄", "►"), lift: 0 };
  return { parts: side("▐", "▌"), lift: 0 };
}

function wrapBark(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = ""; }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function toSpans(row: Cell[], color: boolean): StyledLine {
  const spans: Span[] = [];
  for (const c of row) {
    const style = color ? { ...(c.fg !== NONE ? { fg: hexOf(c.fg) } : {}), ...(c.bg !== NONE ? { bg: hexOf(c.bg) } : {}), ...(c.bold ? { bold: true } : {}) } : {};
    const last = spans.at(-1);
    if (last && last.fg === (style as Span).fg && last.bg === (style as Span).bg && !!last.bold === !!(style as Span).bold) last.text += c.ch;
    else spans.push({ text: c.ch, ...style });
  }
  return spans;
}

const key = (t: Tile2) => `${t.x},${t.y}`;

const DOOR_STATES = ["open", "closed", "locked", "barred", "bolted"];
const isDoorThing = (a: MapActor) => (a.states ?? []).some(s => DOOR_STATES.includes(s)) || /door|gate|hatch|wicket/i.test(a.name);

/** Things first, then people, then the player; overhead things last (they hang over everyone). */
function order(actors: MapActor[]): MapActor[] {
  const rank = (a: MapActor) => (a.states?.includes("overhead") ? 4 : a.kind === "player" ? 3 : a.kind === "person" || a.kind === "creature" ? 2 : a.kind === "object" ? 0 : 1);
  return [...actors].sort((a, b) => rank(a) - rank(b));
}

/** The look of a raised tile: a roofed floor's roof, or a wall's own style. */
const blockStyle = (t: MapTile) => (isRoofed(t) ? t.roof : undefined) ?? t.style ?? DEFAULT_STYLE[t.terrain] ?? "stone";

function groundKey(t: MapTile): string {
  if (t.terrain === "floor" && t.style && GROUND[t.style]) return t.style;
  if (isStructure(t) || t.terrain === "tree" || t.terrain === "void") return t.style && GROUND[t.style] ? t.style : "floor";
  return GROUND[t.terrain] ? t.terrain : "floor";
}

const passable = (map: TileMap, p: Tile2) => inBounds(map, p) && !tileAt(map, p).blocks && !isStructure(tileAt(map, p));

const BUNTING = ["#e04040", "#f0c040", "#4080e0", "#40b060", "#f0f0f0"];
const bunting = (at: Tile2, dx: number) => BUNTING[hash(at.x, at.y, dx) % BUNTING.length]!;

// ---------------------------------------------------------------------------------------------
// Seeing in: the room around the focus loses its roof and its front walls.

interface Opening { cut: Set<string>; lifted: Set<string> }

/**
 * The room the focus stands in: tiles reachable without crossing a wall, door, window or fence,
 * staying under a roof if it started under one. Outdoors (it reaches the map's edge, or it's huge)
 * nothing opens. Indoors, its roofs lift and the walls in front of it (south and west) are cut.
 */
function opening(map: TileMap, focus: Tile2, options: RenderOptions): Opening {
  const cut = new Set<string>(), lifted = new Set<string>();
  if (options.cutaway === false) return { cut, lifted };
  const done = new Set<string>();
  for (const p of [focus, ...(options.reveal ?? [])]) {
    if (done.has(key(p)) || !inBounds(map, p)) continue;
    const room = openRoom(map, p, cut, lifted);
    for (const k of room) done.add(k);
  }
  return { cut, lifted };
}

/** Open the room a tile is in (if it's a room): returns its tiles, so the caller can skip them. */
function openRoom(map: TileMap, focus: Tile2, cut: Set<string>, lifted: Set<string>): Set<string> {
  const start = tileAt(map, focus);
  const underRoof = isRoofed(start);
  const room = new Set<string>([key(focus)]);
  const queue = [focus];
  let outdoors = false;
  while (queue.length && room.size < 900) {
    const p = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!inBounds(map, n)) { outdoors = true; continue; }
      const t = tileAt(map, n);
      if (t.terrain === "void") { outdoors = true; continue; }
      if (isStructure(t) || t.terrain === "tree" || isRoofed(t) !== underRoof) continue;
      const k = key(n);
      if (room.has(k)) continue;
      room.add(k); queue.push(n);
    }
  }
  if (outdoors || room.size >= 900) return room;
  for (const k of room) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (underRoof) lifted.add(k);
    // In front of a tile on screen: west, south and south-west of it.
    for (const [dx, dy] of [[-1, 0], [0, 1], [-1, 1]] as const) {
      const n = { x: x + dx, y: y + dy };
      const t = tileAt(map, n);
      if (isStructure(t) || isRoofed(t)) cut.add(key(n));
    }
  }
  // A wall's far end hides the corner it turns: cut the corner posts beside cut walls too.
  for (const k of [...cut]) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    for (const n of [{ x: x - 1, y: y + 1 }, { x: x - 1, y }, { x, y: y + 1 }]) if (isStructure(tileAt(map, n)) && [...room].some(r => near(r, n))) cut.add(key(n));
  }
  return room;
}

const near = (k: string, p: Tile2) => { const [x, y] = k.split(",").map(Number) as [number, number]; return Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1; };

// ---------------------------------------------------------------------------------------------
// Roofs: each building's footprint gets a ridge along its long axis, and two slopes.

const ROOFS = new WeakMap<TileMap, Uint8Array>();
/** Styles that are walls and earth, not roofs: one tone. */
const FLAT = new Set(["stone", "bank", "hedge", "fence", "panel", "hull", "burnt", "gilt"]);

/**
 * Per tile: 0 not a roof (walls, banks, rooms inside other walls), 1 the lit slope (north or west
 * of the ridge), 2 the ridge, 3 the shaded slope. A building is the connected run of raised tiles
 * of one style; a run with floors of another style inside it (the palace's rooms) isn't a roof.
 */
function roofSlopes(map: TileMap): Uint8Array {
  const cached = ROOFS.get(map);
  if (cached) return cached;
  const out = new Uint8Array(map.width * map.height);
  const seen = new Uint8Array(map.width * map.height);
  const styleOf = blockStyle;
  const raised = (t: MapTile) => (isStructure(t) && (t.height ?? 0) >= 2) || (isRoofed(t) && (t.roofHeight ?? 3) >= 2);
  for (let y0 = 0; y0 < map.height; y0++) for (let x0 = 0; x0 < map.width; x0++) {
    const t0 = map.tiles[y0]![x0]! as MapTile;
    if (seen[y0 * map.width + x0] || !raised(t0) || FLAT.has(styleOf(t0))) continue;
    const style = styleOf(t0);
    const tiles: Tile2[] = [];
    let mixed = false;
    const queue: Tile2[] = [{ x: x0, y: y0 }];
    seen[y0 * map.width + x0] = 1;
    while (queue.length) {
      const p = queue.pop()!;
      tiles.push(p);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = { x: p.x + dx, y: p.y + dy };
        if (!inBounds(map, n)) continue;
        const t = map.tiles[n.y]![n.x]! as MapTile;
        if (isRoofed(t) && styleOf(t) !== style) mixed = true;
        if (seen[n.y * map.width + n.x] || !raised(t) || styleOf(t) !== style) continue;
        seen[n.y * map.width + n.x] = 1;
        queue.push(n);
      }
    }
    const xs = tiles.map(p => p.x), ys = tiles.map(p => p.y);
    const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx + 1, bh = Math.max(...ys) - by + 1;
    if (mixed || Math.min(bw, bh) < 3) continue;
    for (const p of tiles) {
      const along = bw >= bh;
      const v = along ? p.y - by : p.x - bx, n = along ? bh : bw;
      const mid = (n - 1) / 2;
      out[p.y * map.width + p.x] = Math.abs(v - mid) < 0.5 ? 2 : v < mid ? 1 : 3;
    }
  }
  ROOFS.set(map, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Light: the time of day, and lamps, fires, burning things and effects lighting the tiles round them.

/** A light on the map, in tiles: where, how far it reaches, its colour times its strength. */
interface Source {
  x: number; y: number; radius: number; r: number; g: number; b: number;
  /** Not stopped by walls (a building on fire lights the street over them). */
  through?: boolean;
  /** Only lights rooms (daylight through a window). */
  indoors?: boolean;
  /** Only lights the ground, not the wall it's set in (a window's). */
  ground?: boolean;
}

interface Lights { at(x: number, y: number): Light }

/**
 * Light per tile, Brogue-style: the time of day's daylight (dimmer in a room whose roof is lifted)
 * plus every source in reach, coloured, falling off softly and stopped by walls (anything opaque
 * between the light and the tile; a wall is lit on its face). A tile's light is worked out the
 * first time it's asked for.
 */
function lighting(map: TileMap, options: RenderOptions, open: Opening, sources: Source[], passes: (x: number, y: number) => boolean): Lights {
  const day = DAYLIGHT[options.time ?? "afternoon"];
  const ambient = (a: { level: number; tint: string }): Light => {
    const c = rgbOf(a.tint);
    return { r: ((c >> 16) & 255) / 255 * a.level, g: ((c >> 8) & 255) / 255 * a.level, b: (c & 255) / 255 * a.level };
  };
  const outdoor = ambient(day.outdoor), indoor = ambient(day.indoor);
  const cache: Array<Light | undefined> = new Array(map.width * map.height);
  /** Can a light get to a tile? Walk the line: the tiles between must let it through. */
  const reaches = (s: Source, x: number, y: number) => {
    const x0 = Math.round(s.x), y0 = Math.round(s.y);
    const steps = Math.max(Math.abs(x - x0), Math.abs(y - y0));
    for (let i = 1; i < steps; i++) {
      const px = Math.round(x0 + ((x - x0) * i) / steps), py = Math.round(y0 + ((y - y0) * i) / steps);
      if (!passes(px, py)) return false;
    }
    return true;
  };
  return {
    at(x, y) {
      const i = y * map.width + x;
      const hit = cache[i];
      if (hit) return hit;
      const tile = tileAt(map, { x, y });
      const inside = isRoofed(tile) && (options.roofs === false || open.lifted.has(`${x},${y}`));
      const built = isStructure(tile) || (isRoofed(tile) && !inside);
      const base = inside ? indoor : outdoor;
      let r = base.r, g = base.g, b = base.b, lit = false;
      for (const s of sources) {
        const dx = x - s.x, dy = y - s.y;
        if (dx >= s.radius || -dx >= s.radius || dy >= s.radius || -dy >= s.radius) continue;
        const q2 = (dx * dx + dy * dy) / (s.radius * s.radius);
        if (q2 >= 1 || (s.indoors && !inside) || (s.ground && built) || (!s.through && !reaches(s, x, y))) continue;
        const f = (1 - q2) * (1 - q2);
        r += s.r * f; g += s.g * f; b += s.b * f; lit = true;
      }
      const light = lit ? { r, g, b } : base;
      cache[i] = light;
      return light;
    },
  };
}
