// Copied from the prototype's src/game/look/stage.ts at 44c6d4a, whole; the world from v2/shared/world.
import { heldBy, positionOf, type Entity, type Point, type Rect, type SceneWorld } from "../../shared/world/scene-world.ts";
import { lookOf, type Look, type TimeOfDay } from "./appearance.ts";
import { BEING, BOLD, Canvas, FAINT, GLOW, INK, UNLIT, WALL } from "./canvas.ts";
import { FLAME_LIGHT, FLAME_RAMPS, hexOf, mix, ramp, rgbOf, scale, type FlameName, type RGB } from "./color.ts";
import { areaCell, type Effects } from "./effects.ts";
import { inSet, plainText, type GlyphSet } from "./glyphs.ts";
import { LightField, ambientOf, glint, shade, shadeBeing } from "./light.ts";
import { clamp01, hash, hash01, noise1, noise2, noise3, seedOf, smoothstep } from "./noise.ts";
import { SIZE_SCALE } from "./roles.ts";
import { surfacesOf } from "./surfaces.ts";
import { doorLook, type DoorLook } from "./door-art.ts";
import type { LampShape } from "./lamp-art.ts";
import { stageLampsDrawn } from "./lamps.ts";
import {
  cloudCell, cloudDensity, flameCell, groundCell, rainAt, surfaceCell, wallCell,
  type CloudKind, type Ground, type SurfaceKind, type TCell, type TerrainContext, type WallStyle, type Weather,
} from "./terrain.ts";

/**
 * The stage: a top-down view of a scene's world, Caves of Qud style, built from the look layer.
 * The scene world knows areas and things in feet but not floors or walls, so a Dressing says what
 * the ground is, where the walls and windows run, which areas are indoors, and where the river is.
 * (The map module's tile maps know all that already; its isometric renderer composes the same
 * layers in the same order: see README.md.)
 *
 * Back to front: ground, surfaces on it (puddles, oil, blood, ash), walls and doors, big things
 * (tables, the hearth, the elm's canopy), small things, people, effects; then ambient life (embers,
 * smoke, dust motes, steam, snores), weather and haze; then light; then floating text, unlit so it
 * always reads.
 */

export interface Dressing {
  /** Ground by area id (default: cobbles outside, boards in). */
  ground?: Record<string, Ground>;
  /** Patches over the areas: a river, puddles, a rug, rubble. Feet. */
  patches?: Array<{ ground?: Ground; surface?: SurfaceKind; rect?: Rect; circle?: { x: number; y: number; r: number }; flow?: { x: number; y: number }; ragged?: number }>;
  /** Walls, as segments in feet. Doors are where door things stand on them. */
  walls?: Array<{ from: [number, number]; to: [number, number]; style?: WallStyle }>;
  /** Areas that are indoors (dim by day, dark at night). */
  indoor?: string[];
  /** Windows and openings on the walls (feet): glass, and daylight let in. */
  windows?: Array<{ at: [number, number]; radius: number; glass?: boolean }>;
  wind?: { dir: number; strength: number };
  weather?: Weather;
  /** Things the dressing already draws (walls, steps, the river) or that shouldn't show. */
  hide?: string[];
  /** A haze hanging in an area (a smoky room, a dusty loft). */
  haze?: Array<{ area: string; kind: CloudKind; density: number }>;
}

export interface StageView {
  w: number;
  h: number;
  /** Milliseconds: the animation clock. */
  t: number;
  time: TimeOfDay;
  glyphs?: GlyphSet;
  effects?: Effects;
  /** Feet per column (rows are twice that). Default: fit the place to the view. */
  scale?: number;
  /** A point (feet) to put in the middle of the view (with a scale, to zoom in on part of a place). */
  focus?: Point;
  /** Where to draw people and things this frame (tweens), when not where the world has them. */
  positions?: (id: string) => Point | undefined;
  weather?: Weather;
  /** Ids to leave out (people who've left, a cast filter). */
  omit?: Set<string>;
  /** Filled in with what's drawn where, for the mouse: pick.at(x, y) is who or what is in a cell, and the floor there. */
  pick?: StagePicks;
  /** What the pointer is on, lit up: someone or something (every cell drawn for them), or a cell of floor. */
  hover?: string | { x: number; y: number };
}

/** What's in a cell of a stage frame: who or what is drawn there, and the floor under it. */
export interface StagePick {
  /** Who or what is drawn there (the topmost: people over things over the floor), by world id. */
  id?: string;
  /** What else was drawn in the cell, under it (topmost first): the rope Prout hangs from, the puddle Cob stands in. */
  under?: string[];
  /** The area the cell is in (the place's own id outside every area; none past the place's edge). */
  area?: string;
  /** What the ground is ("cobbles", "boards", "river", "void" past the edge). */
  ground?: string;
  /** A wall there, and what it's built of; a window in it. */
  wall?: string;
  window?: boolean;
  /** Something the dressing has lying there: a puddle, mud, straw. */
  patch?: string;
  /** The cell's middle, in the world's feet. */
  at: Point;
}

/**
 * A door the stage drew in a wall's line (a cell of the wall, in the door's look), for the
 * browser's overlay (src/game/look/overlay.ts), which draws it there as a plan draws a door, at a
 * door's width: where it is, which way the wall runs, which side it opens to, how it looks, and the
 * light and floor round it.
 */
export interface StageDoorPick {
  id: string;
  /** Its cell, in the wall's line. */
  x: number;
  y: number;
  /** The way the wall runs: across the screen (x) or up and down it (y). */
  along: "x" | "y";
  /** The side it opens to: 1 south or east of the wall, -1 north or west. */
  side: 1 | -1;
  /** Feet per column, as the stage laid the place out (rows are twice that). */
  scale: number;
  /** A gate or double doors: twice a door's width, two leaves. */
  wide: boolean;
  look: DoorLook;
  /** How brightly its cell is lit (as a level: the stage tints things its own way), and the floor's colour beside it, lit. */
  light: number;
  floor: string;
}

/**
 * What a stage frame drew where, for the mouse (as the map's Picks are for the town): for each cell,
 * who or what is drawn in it, and the floor under it. renderStage fills it in as it paints, so
 * picking agrees with drawing: a click on someone's letter is a click on them, on a puddle's
 * ripples the puddle, on a wall the wall the world knows (what the dressing draws in its stead).
 *
 * Asked for (new StagePicks({ doors: true })), it also keeps the doors drawn in walls
 * (StageDoorPick), and the cells where something stands or is drawn over the floor and the walls
 * (`covered`: people and things, effects, floating text, the pointer's highlight), for the browser's
 * overlay.
 */
export class StagePicks {
  w = 0;
  h = 0;
  /** The scene the frame was of. */
  scene = "";
  /** The doors drawn in walls (when asked for). */
  doors?: StageDoorPick[];
  /** By cell: 1 where someone or something stands, or something's drawn over the floor and walls (when asked for). */
  covered?: Uint8Array;
  /** The lamp posts drawn, for their pictures (src/game/look/lamps.ts), when the doors are asked for. */
  lamps?: LampShape[];
  private cells: StageCells = { owner: new Int32Array(0), ids: [], drew: [], layers: new Map() };
  private floor: (x: number, y: number) => Omit<StagePick, "id" | "under"> = () => ({ at: { x: 0, y: 0 } });

  constructor(options: { doors?: boolean } = {}) {
    if (options.doors) this.doors = [];
  }

  /** Whether renderStage is to keep the doors and what covers the floor. */
  get tracking(): boolean { return !!this.doors; }

  /** Take a frame's picks (renderStage calls this). */
  fill(w: number, h: number, scene: string, cells: StageCells, floor: (x: number, y: number) => Omit<StagePick, "id" | "under">, doors?: { doors: StageDoorPick[]; covered: Uint8Array }): void {
    this.w = w; this.h = h; this.scene = scene; this.cells = cells; this.floor = floor;
    if (doors && this.doors) { this.doors = doors.doors; this.covered = doors.covered; }
  }

  /** Who or what is drawn in a cell (and what's under them), and the floor there; undefined off the frame. */
  at(x: number, y: number): StagePick | undefined {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    const i = y * this.w + x;
    const o = this.cells.owner[i] ?? -1;
    const under = (this.cells.layers.get(i) ?? []).filter(n => n !== o).reverse().map(n => this.cells.ids[n]!);
    return { ...this.floor(x, y), ...(o >= 0 ? { id: this.cells.ids[o]! } : {}), ...(under.length ? { under } : {}) };
  }

  /** Everyone and everything drawn in the frame (covered or not), once each, in the order they were drawn. */
  shown(): string[] {
    return this.cells.ids.filter((_, n) => this.cells.drew[n]?.length);
  }

  /** Where someone or something is drawn (the middle of what shows of them, or of where they're covered); undefined if nowhere. */
  cellOf(id: string): { x: number; y: number } | undefined {
    const cells = cellsFor(this.cells, id);
    const i = cells[Math.floor(cells.length / 2)];
    return i === undefined ? undefined : { x: i % this.w, y: Math.floor(i / this.w) };
  }
}

/** Whose each cell of a frame is: its owner (the last drawn there), and everyone else who was drawn there. */
export interface StageCells {
  /** By cell: an index into ids, or -1. */
  owner: Int32Array;
  ids: string[];
  /** By index into ids: every cell each one drew. */
  drew: number[][];
  /** Cells more than one drew, and who did (in the order they drew). */
  layers: Map<number, number[]>;
}

/** The cells that show someone or something; if none do, the cells they're drawn in under something else. */
function cellsFor(cells: StageCells, id: string): number[] {
  const n = cells.ids.indexOf(id);
  if (n < 0) return [];
  const own = (cells.drew[n] ?? []).filter(i => cells.owner[i] === n);
  return own.length ? own : cells.drew[n] ?? [];
}

/** The pointer's highlight (the map's own). */
const HOVER = rgbOf("#9ab8e8");
/** What each wall style is built of, so a wall the dressing draws stands in for the world's wall of that stuff. */
const WALL_MATERIAL: Record<WallStyle, string> = { stone: "stone", brick: "stone", bank: "stone", palace: "stone", plaster: "stone", timber: "wood", hedge: "wood", glass: "glass" };

export interface StageLayout {
  scale: number;
  ox: number;
  oy: number;
  toCell(p: Point): { x: number; y: number };
  toFeet(cx: number, cy: number): Point;
}

const GROUNDS: Ground[] = ["cobbles", "flags", "boards", "loft", "dirt", "mud", "grass", "straw", "carpet", "steps", "sand", "rubble", "scorched", "void", "water", "deep-water", "river", "puddle"];
const WALLS: WallStyle[] = ["stone", "timber", "bank", "brick", "plaster", "palace", "hedge", "glass"];
const SURFACE_KINDS: SurfaceKind[] = ["water", "oil", "spirits", "blood", "ale", "wine", "slops", "milk", "honey", "ink", "mud", "ash", "char", "ice", "snow", "dust", "grain", "straw", "acid", "slime", "vomit", "tar", "grease", "scorch"];

export function layoutOf(world: SceneWorld, w: number, h: number, scale?: number, focus?: Point): StageLayout {
  const root = world.entities[world.root]!.rect ?? { x: 0, y: 0, w: 40, h: 30 };
  const s = scale ?? Math.max(0.45, root.w / w, root.h / (2 * h));
  const cols = Math.ceil(root.w / s), rows = Math.ceil(root.h / (2 * s));
  const ox = focus ? Math.floor(w / 2 - (focus.x - root.x) / s) : Math.floor((w - cols) / 2);
  const oy = focus ? Math.floor(h / 2 - (focus.y - root.y) / (2 * s)) : Math.floor((h - rows) / 2);
  return {
    scale: s, ox, oy,
    toCell: p => ({ x: Math.floor(ox + (p.x - root.x) / s), y: Math.floor(oy + (p.y - root.y) / (2 * s)) }),
    toFeet: (cx, cy) => ({ x: root.x + (cx - ox + 0.5) * s, y: root.y + (cy - oy + 0.5) * 2 * s }),
  };
}

// ---------------------------------------------------------------------------------------------
// What doesn't change during a scene: areas, floors, walls, patches. Built once per size.

interface Static {
  key: string;
  area: Int16Array;
  areas: Entity[];
  ground: Uint8Array;
  wall: Uint8Array;
  window: Uint8Array;
  indoor: Uint8Array;
  patch: Uint8Array;
  depth: Float32Array;
  flowX: Float32Array;
  flowY: Float32Array;
}
const statics = new WeakMap<Dressing, Map<string, Static>>();

function staticLayer(world: SceneWorld, dressing: Dressing, w: number, h: number, L: StageLayout): Static {
  const key = `${world.scene}|${w}x${h}|${L.scale.toFixed(4)}|${L.ox},${L.oy}`;
  let byKey = statics.get(dressing);
  if (!byKey) { byKey = new Map(); statics.set(dressing, byKey); }
  const hit = byKey.get(key);
  if (hit) return hit;
  const n = w * h;
  const areas = Object.values(world.entities).filter(e => e.kind === "area" && e.rect).sort((a, b) => a.rect!.w * a.rect!.h - b.rect!.w * b.rect!.h);
  const root = world.entities[world.root]!.rect!;
  const st: Static = { key, area: new Int16Array(n).fill(-1), areas, ground: new Uint8Array(n), wall: new Uint8Array(n), window: new Uint8Array(n), indoor: new Uint8Array(n), patch: new Uint8Array(n), depth: new Float32Array(n), flowX: new Float32Array(n), flowY: new Float32Array(n) };
  const inRect = (p: Point, r: Rect) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = cy * w + cx;
    const p = L.toFeet(cx, cy);
    if (!inRect(p, root)) { st.ground[i] = GROUNDS.indexOf("void"); continue; }
    const ai = areas.findIndex(a => inRect(p, a.rect!));
    st.area[i] = ai;
    const area = areas[ai];
    const g: Ground = (area && dressing.ground?.[area.id]) ?? (area?.tags.includes("outside") ? "cobbles" : area ? "boards" : "void");
    st.ground[i] = GROUNDS.indexOf(g);
    if (area && (dressing.indoor ?? []).includes(area.id)) st.indoor[i] = 1;
    // Patches: the river, puddles, a rug. Ragged edges come from noise, so puddles aren't boxes.
    (dressing.patches ?? []).forEach((patch, pi) => {
      let depth = 0;
      const rag = patch.ragged ?? 0.35;
      const nz = (noise2(p.x * 0.35, p.y * 0.35, 900 + pi) - 0.5) * rag * 2;
      if (patch.rect) {
        const r = patch.rect;
        const inside = Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y);
        depth = clamp01(inside / Math.max(1.5, Math.min(r.w, r.h) * 0.3) + nz);
      } else if (patch.circle) {
        const d = Math.hypot(p.x - patch.circle.x, (p.y - patch.circle.y) * 1.1) / patch.circle.r;
        depth = clamp01((1 - d) * 2.2 + nz);
      }
      if (depth <= 0) return;
      if (patch.ground) {
        if (depth > 0.12) { st.ground[i] = GROUNDS.indexOf(patch.ground); if (patch.flow) { st.flowX[i] = patch.flow.x; st.flowY[i] = patch.flow.y; } }
      } else if (patch.surface) {
        st.patch[i] = SURFACE_KINDS.indexOf(patch.surface) + 1;
        st.depth[i] = depth;
      }
    });
  }
  const mark = (fx: number, fy: number, style: WallStyle) => {
    const c = L.toCell({ x: fx, y: fy });
    if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) st.wall[c.y * w + c.x] = WALLS.indexOf(style) + 1;
  };
  for (const wall of dressing.walls ?? []) {
    const [x0, y0] = wall.from, [x1, y1] = wall.to;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0) / L.scale, Math.abs(y1 - y0) / (2 * L.scale)) * 2));
    for (let s = 0; s <= steps; s++) mark(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, wall.style ?? "stone");
  }
  for (const win of dressing.windows ?? []) {
    const c = L.toCell({ x: win.at[0], y: win.at[1] });
    if (win.glass === false) continue;
    const half = Math.max(0, Math.round(win.radius / 6 / L.scale));
    for (let dx = -half; dx <= half; dx++) {
      const x = c.x + dx;
      if (x >= 0 && x < w && c.y >= 0 && c.y < h && st.wall[c.y * w + x]) st.window[c.y * w + x] = 1;
    }
  }
  byKey.set(key, st);
  return st;
}

// ---------------------------------------------------------------------------------------------
// The frame.

const BURN_RANK = (e: Entity) => (e.player ? 5 : e.kind === "person" || e.kind === "creature" ? 4 : 1);
const CONTAINS = /^(sack|chest|barrel|bucket|basket|crate|boots|clothing|robes|jar|bottle|pot)$/;

export function renderStage(world: SceneWorld, dressing: Dressing, view: StageView): Canvas {
  const { w, h, t } = view;
  const set = view.glyphs ?? "ascii";
  const fx = view.effects?.frame(t, id => view.positions?.(id) ?? positionOf(world, id));
  const L0 = layoutOf(world, w, h, view.scale, view.focus);
  const shake = fx?.shake ?? { dx: 0, dy: 0 };
  const L: StageLayout = shake.dx || shake.dy ? { ...L0, ox: L0.ox + shake.dx, oy: L0.oy + shake.dy, toCell: p => { const c = L0.toCell(p); return { x: c.x + shake.dx, y: c.y + shake.dy }; }, toFeet: (cx, cy) => L0.toFeet(cx - shake.dx, cy - shake.dy) } : L0;
  const st = staticLayer(world, dressing, w, h, L0);
  const canvas = new Canvas(w, h, INK);
  const s = L.scale;
  const tctx: TerrainContext = { t, time: view.time, glyphs: set, ...(dressing.wind ? { wind: dressing.wind } : {}) };
  const opaque = new Uint8Array(w * h);
  const lights: Array<{ x: number; y: number; radius: number; color: RGB; intensity: number }> = [];
  const where = (id: string) => view.positions?.(id) ?? positionOf(world, id);
  const at = (cx: number, cy: number) => {
    // Shaken frames read the static layer where the cell came from.
    const sx = cx - shake.dx, sy = cy - shake.dy;
    return sx >= 0 && sy >= 0 && sx < w && sy < h ? sy * w + sx : -1;
  };

  // Whose each cell is, as it's drawn (for the mouse, and the pointer's highlight): the last to
  // draw a cell owns it, so people own theirs over the table they stand at; the rest are under them.
  const tracked: StageCells | undefined = view.pick || typeof view.hover === "string" ? { owner: new Int32Array(w * h).fill(-1), ids: [], drew: [], layers: new Map() } : undefined;
  const owner = tracked?.owner;
  const ownerOf = new Map<string, number>();
  const owning = (id: string | undefined): ((i: number) => void) | undefined => {
    if (!tracked || !id) return undefined;
    let n = ownerOf.get(id);
    if (n === undefined) { n = tracked.ids.length; tracked.ids.push(id); tracked.drew.push([]); ownerOf.set(id, n); }
    const k = n;
    return i => {
      if (i < 0 || i >= tracked.owner.length) return;
      const was = tracked.owner[i]!;
      if (was === k) return;
      if (was >= 0) {
        const layer = tracked.layers.get(i) ?? [was];
        if (!layer.includes(k)) layer.push(k);
        tracked.layers.set(i, layer);
      }
      tracked.owner[i] = k;
      tracked.drew[k]!.push(i);
    };
  };
  // What the dressing draws in the world's stead (the yard wall, the river, the river steps): a
  // cell of it belongs to the nearest of them that it could be (a timber wall isn't the stone one).
  const dressed = (dressing.hide ?? []).map(id => world.entities[id]).filter((e): e is Entity => !!e && !e.states.includes("gone"));
  const standIn = (re: RegExp, p: Point, material?: string): string | undefined => {
    let best: { id: string; d: number } | undefined;
    for (const e of dressed) {
      if (!re.test(`${e.id} ${e.name}`) || (material && e.material && e.material !== material)) continue;
      const q = positionOf(world, e.id);
      const d = q ? Math.hypot(q.x - p.x, q.y - p.y) : Infinity;
      if (!best || d < best.d) best = { id: e.id, d };
    }
    return best?.id;
  };

  // 1. Ground, and the area states that change it (exploded floors are scorched).
  const areaStates = st.areas.map(a => world.entities[a.id]?.states ?? []);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const si = at(cx, cy);
    if (si < 0) continue;
    let g = GROUNDS[st.ground[si]!]!;
    const ai = st.area[si]!;
    if (ai >= 0 && areaStates[ai]!.some(x => x === "exploded" || x === "scorched" || x === "burnt") && g !== "water" && g !== "river" && g !== "deep-water") g = "scorched";
    const flow = st.flowX[si] || st.flowY[si] ? { x: st.flowX[si]!, y: st.flowY[si]! } : undefined;
    let cell = groundCell(g, cx - shake.dx, cy - shake.dy, flow ? { ...tctx, flow } : tctx);
    const pk = st.patch[si]!;
    if (pk) cell = surfaceCell(SURFACE_KINDS[pk - 1]!, cell, cx, cy, st.depth[si]!, st.indoor[si] ? { ...tctx, indoor: true } : tctx);
    put(canvas, cx, cy, cell);
    if (owner && dressed.length && (g === "river" || g === "water" || g === "deep-water" || g === "steps")) {
      owning(standIn(g === "steps" ? /step|stair/i : /river|water|stream|canal/i, L.toFeet(cx, cy)))?.(cy * w + cx);
    }
  }

  // 2. Surfaces in the world (puddles, oil, blood, ash...), some of them burning.
  const { surfaces, clouds } = surfacesOf(world, where);
  for (const sp of surfaces) {
    const c = L.toCell(sp);
    const rx = Math.ceil(sp.radius / s) + 1, ry = Math.ceil(sp.radius / (2 * s)) + 1;
    const burning = sp.states.includes("burning");
    const frozen = sp.states.includes("frozen");
    const own = owning(world.entities[sp.id] ? sp.id : undefined);
    for (let cy = c.y - ry; cy <= c.y + ry; cy++) for (let cx = c.x - rx; cx <= c.x + rx; cx++) {
      if (!canvas.inside(cx, cy)) continue;
      const p = L.toFeet(cx, cy);
      const d = Math.hypot(p.x - sp.x, p.y - sp.y) / sp.radius;
      const depth = clamp01((1 - d) * 2.4 + (noise2(p.x * 0.45, p.y * 0.45, sp.seed) - 0.5) * 0.9);
      if (depth <= 0.02) continue;
      const i = cy * w + cx;
      const under: TCell = { glyph: canvas.glyph[i]!, fg: canvas.fg[i]!, bg: canvas.bg[i]! };
      const si = at(cx, cy);
      let cell = surfaceCell(frozen ? "ice" : sp.kind, under, cx, cy, depth, si >= 0 && st.indoor[si] ? { ...tctx, indoor: true } : tctx);
      if (burning && depth > 0.15) cell = flameCell(sp.kind === "spirits" ? "blue" : "fire", cell, cx, cy, clamp01(depth * 1.2), { ...tctx, seed: sp.seed });
      put(canvas, cx, cy, cell);
      own?.(i);
    }
    if (burning) lights.push({ x: c.x, y: c.y, radius: (sp.radius + 10) / s, color: rgbOf(sp.kind === "spirits" ? FLAME_LIGHT.blue : FLAME_LIGHT.fire), intensity: 1.1 + 0.25 * noise1(t / 120, sp.seed) });
  }

  // 3. Walls, windows; doors where door things stand.
  const doorCells = new Map<number, { look: Look; open: boolean; id: string; e: Entity; p: Point }>();
  for (const e of Object.values(world.entities)) {
    if (!e.tags.includes("door") || e.states.includes("gone")) continue;
    const p = where(e.id);
    if (!p) continue;
    const c = L.toCell(p);
    let best: number | undefined;
    // The nearest wall cell within about four feet: doors are authored near their walls, not on them.
    const reach = Math.max(2, Math.ceil(4 / s));
    for (let r = 0; r <= reach && best === undefined; r++) for (let dy = -Math.ceil(r / 2); dy <= Math.ceil(r / 2) && best === undefined; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = c.x + dx, y = c.y + dy, si = at(x, y);
      if (si >= 0 && st.wall[si]) { best = y * w + x; break; }
    }
    if (best === undefined) continue;
    const look = lookOf(e, { t, time: view.time, glyphs: set, seed: seedOf(e.id) });
    doorCells.set(best, { look, open: e.states.includes("open") || e.states.includes("destroyed") || e.states.includes("broken"), id: e.id, e, p });
  }
  // For the browser's overlay (StagePicks): the doors drawn, and where something stands or is drawn over the floor and walls.
  const covered = view.pick?.tracking && tracked ? new Uint8Array(w * h) : undefined;
  const drawnDoors: Array<{ i: number; door: { look: Look; id: string; e: Entity; p: Point } }> = [];
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const si = at(cx, cy);
    if (si < 0 || !st.wall[si]) continue;
    const i = cy * w + cx;
    const door = doorCells.get(i);
    if (door) {
      const fg = rgbOf(door.look.fg);
      canvas.put(cx, cy, door.look.glyph, fg, door.open ? rgbOf("#120e0a") : scale(fg, 0.42), BOLD);
      if (!door.open) opaque[i] = 1;
      owning(door.id)?.(i);
      if (covered) drawnDoors.push({ i, door });
      continue;
    }
    if (st.window[si]) {
      const lit = view.time === "night" || view.time === "evening";
      canvas.put(cx, cy, inSet((cx + cy) % 3 ? "▒" : "░", set), rgbOf(lit ? "#e8c070" : "#b8dcf0"), rgbOf(lit ? "#3a2a1a" : "#3a5a74"));
      canvas.spec[i] = 0.4;
      if (owner && dressed.length) owning(standIn(/window/i, L.toFeet(cx, cy)))?.(i);
      continue;
    }
    const style = WALLS[st.wall[si]! - 1]!;
    if (owner && dressed.length) owning(standIn(/wall/i, L.toFeet(cx, cy), WALL_MATERIAL[style]))?.(i);
    put(canvas, cx, cy, wallCell(style, cx - shake.dx, cy - shake.dy, tctx));
    canvas.flags[i] = canvas.flags[i]! | WALL;
    // Glass lets the light through.
    if (style !== "glass") opaque[i] = 1;
  }

  // 4. Things and people, big things first, people last, the player on top.
  const hidden = new Set(dressing.hide ?? []);
  const entities = Object.values(world.entities).filter(e => e.kind !== "place" && e.kind !== "area" && !e.tags.includes("door") && !hidden.has(e.id) && !view.omit?.has(e.id) && !e.states.includes("gone"));
  const looks = new Map<string, { e: Entity; look: Look; c: { x: number; y: number } }>();
  for (const e of entities) {
    const holder = heldBy(world, e);
    if (holder && (holder.kind === "person" || holder.kind === "creature")) continue;
    if (holder && !e.states.includes("hanging") && !e.tags.includes("body")) {
      const hl = lookOf(holder, {});
      if (CONTAINS.test(hl.role) || holder.tags.includes("container")) continue;
    }
    // Surfaces were drawn as patches.
    if (surfaces.some(sp => sp.id === e.id) || clouds.some(cl => cl.id === e.id)) continue;
    const p = where(e.id);
    if (!p) continue;
    const look = lookOf(e, { t, time: view.time, glyphs: set, seed: seedOf(e.id) });
    if ((look.alpha ?? 1) <= 0) continue;
    looks.set(e.id, { e, look, c: L.toCell(p) });
  }
  const order = [...looks.values()].sort((a, b) => rank(a) - rank(b));
  const emitters: Emitter[] = [];
  for (const { e, look, c } of order) {
    if (look.light) lights.push({ x: c.x + 0.5, y: c.y + 0.5, radius: look.light.radius / s, color: rgbOf(look.light.color), intensity: look.light.intensity });
    const fp = footprintCells(e, look, s);
    const own = owning(e.id);
    if (fp && (fp.w > 1 || fp.h > 1) && look.stamp) stamp(canvas, look, e, c, fp, t, tctx, own);
    else drawOne(canvas, look, e, c, t, set, own);
    if (look.burning) emitters.push({ kind: "fire", x: c.x, y: c.y, w: fp?.w ?? 1, h: fp?.h ?? 1, seed: seedOf(e.id), strength: look.burning, flame: look.flame ?? "fire" });
    else if (e.states.includes("smouldering")) emitters.push({ kind: "smoulder", x: c.x, y: c.y, w: fp?.w ?? 1, h: 1, seed: seedOf(e.id), strength: 0.5, flame: "fire" });
    if (e.states.some(x => x === "asleep" || x === "unconscious" || x === "sleeping")) emitters.push({ kind: "zzz", x: c.x, y: c.y, w: 1, h: 1, seed: seedOf(e.id), strength: 1, flame: "fire" });
    if (look.role === "stew" || (look.role === "pot" && /stew|soup|broth/i.test(e.name + (e.description ?? "")))) emitters.push({ kind: "steam", x: c.x, y: c.y, w: fp?.w ?? 1, h: 1, seed: seedOf(e.id), strength: 0.6, flame: "fire" });
  }

  // Areas on fire (the dust went up), and dusty air.
  st.areas.forEach((a, ai) => {
    const states = areaStates[ai]!;
    const r = a.rect!;
    const c0 = L.toCell({ x: r.x, y: r.y }), c1 = L.toCell({ x: r.x + r.w, y: r.y + r.h });
    if (states.includes("burning")) {
      for (let cy = c0.y; cy < c1.y; cy++) for (let cx = c0.x; cx < c1.x; cx++) {
        if (!canvas.inside(cx, cy) || opaque[cy * w + cx]) continue;
        const heat = noise3(cx * 0.3, cy * 0.6 + t / 400, t / 900, seedOf(a.id));
        if (heat < 0.5) continue;
        const i = cy * w + cx;
        put(canvas, cx, cy, flameCell("fire", { glyph: canvas.glyph[i]!, fg: canvas.fg[i]!, bg: canvas.bg[i]! }, cx, cy, (heat - 0.5) * 2.2, tctx));
      }
      lights.push({ x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2, radius: Math.max(c1.x - c0.x, (c1.y - c0.y) * 2) * 0.75, color: rgbOf("#ff8a3c"), intensity: 1 + 0.2 * noise1(t / 150, seedOf(a.id)) });
      emitters.push({ kind: "fire", x: Math.round((c0.x + c1.x) / 2), y: Math.round((c0.y + c1.y) / 2), w: c1.x - c0.x, h: c1.y - c0.y, seed: seedOf(a.id) + 1, strength: 1, flame: "fire" });
    }
    if (states.includes("dusty") && !states.includes("exploded")) {
      emitters.push({ kind: "dust", x: c0.x, y: c0.y, w: c1.x - c0.x, h: c1.y - c0.y, seed: seedOf(a.id), strength: 1, flame: "fire" });
      // The air itself is thick with it: a slow haze, drifting.
      for (let cy = c0.y; cy < c1.y; cy++) for (let cx = c0.x; cx < c1.x; cx++) {
        if (!canvas.inside(cx, cy) || opaque[cy * w + cx]) continue;
        const d = 0.3 + 0.7 * smoothstep(0.25, 0.8, noise3(cx * 0.1 + t / 6000, cy * 0.22, t / 5000, seedOf(a.id) + 3));
        if (d < 0.04) continue;
        const i = cy * w + cx;
        const cell = cloudCell("dust", { glyph: canvas.glyph[i]!, fg: canvas.fg[i]!, bg: canvas.bg[i]! }, d, tctx);
        canvas.fg[i] = cell.fg; canvas.bg[i] = cell.bg;
      }
    }
  });

  // 5. Effects: things on the ground, then in the air, then areas (rings, fireballs, flashes).
  const beforeEffects = covered && fx ? snapshot(canvas) : undefined;
  if (fx) {
    for (const sp of fx.sprites) if (sp.layer === 0) sprite(canvas, sp, L, s, set);
    for (const sp of fx.sprites) if (sp.layer > 0) sprite(canvas, sp, L, s, set);
    for (const area of fx.areas) {
      const c = L.toCell(area);
      const rx = Math.ceil((area.radius + area.width) / s) + 1, ry = Math.ceil((area.radius + area.width) / (2 * s)) + 1;
      for (let cy = c.y - ry; cy <= c.y + ry; cy++) for (let cx = c.x - rx; cx <= c.x + rx; cx++) {
        if (!canvas.inside(cx, cy)) continue;
        const p = L.toFeet(cx, cy);
        const a = areaCell(area, p.x, p.y, t);
        if (!a) continue;
        const i = cy * w + cx;
        if (a.glyph) canvas.glyph[i] = inSet(a.glyph, set);
        canvas.fg[i] = mix(canvas.fg[i]!, a.fg, a.mixFg);
        if (a.bg !== undefined) canvas.bg[i] = mix(canvas.bg[i]!, a.bg, a.mixBg);
        if (a.glow) canvas.flags[i] = canvas.flags[i]! | GLOW;
      }
    }
    for (const l of fx.lights) { const c = L.toCell(l); lights.push({ x: c.x, y: c.y, radius: l.radius / s, color: l.color, intensity: l.intensity }); }
  }
  if (covered && beforeEffects) changedSince(canvas, beforeEffects, covered);

  // 6. Life in the air: embers and smoke from what burns, steam, dust motes, snores.
  for (const em of emitters) emit(canvas, em, t, set, dressing.wind);

  // 7. Weather (outdoors) and haze; clouds in the world.
  const weather = view.weather ?? dressing.weather ?? "clear";
  if (weather !== "clear") for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const si = at(cx, cy);
    if (si < 0 || st.indoor[si] || st.wall[si] || GROUNDS[st.ground[si]!] === "void") continue;
    const g = GROUNDS[st.ground[si]!]!;
    const drop = rainAt(cx, cy, weather, tctx, g === "water" || g === "river" || g === "deep-water" || g === "puddle" || st.patch[si]! > 0);
    if (!drop) continue;
    const i = cy * w + cx;
    canvas.glyph[i] = inSet(drop.glyph, set);
    canvas.fg[i] = mix(canvas.bg[i]!, drop.fg, drop.alpha);
  }
  for (const hz of dressing.haze ?? []) {
    const ai = st.areas.findIndex(a => a.id === hz.area);
    if (ai < 0) continue;
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      const si = at(cx, cy);
      if (si < 0 || st.area[si] !== ai || st.wall[si]) continue;
      const d = hz.density * smoothstep(0.35, 0.75, noise3(cx * 0.12 - t / 9000, cy * 0.25, t / 7000, 77 + ai));
      if (d < 0.02) continue;
      const i = cy * w + cx;
      const cell = cloudCell(hz.kind, { glyph: canvas.glyph[i]!, fg: canvas.fg[i]!, bg: canvas.bg[i]! }, d, tctx);
      canvas.fg[i] = cell.fg; canvas.bg[i] = cell.bg;
    }
  }
  for (const cl of clouds) {
    const c = L.toCell(cl);
    const rx = Math.ceil(cl.radius * 1.4 / s) + 1, ry = Math.ceil(cl.radius * 1.4 / (2 * s)) + 1;
    // A cloud is what's pointed at where nothing else is: through it, people and things are still themselves.
    const own = owning(world.entities[cl.id] ? cl.id : undefined);
    for (let cy = c.y - ry; cy <= c.y + ry; cy++) for (let cx = c.x - rx; cx <= c.x + rx; cx++) {
      if (!canvas.inside(cx, cy)) continue;
      const d = cloudDensity(cx, cy, c, cl.radius / s, tctx, cl.seed) * cl.density;
      if (d < 0.03) continue;
      const i = cy * w + cx;
      const cell = cloudCell(cl.kind, { glyph: canvas.glyph[i]!, fg: canvas.fg[i]!, bg: canvas.bg[i]! }, d, tctx);
      canvas.glyph[i] = cell.glyph; canvas.fg[i] = cell.fg; canvas.bg[i] = cell.bg;
      if (own && d >= 0.25 && owner![i]! < 0) own(i);
    }
  }

  // 8. Light: daylight by area, windows by day, and every lamp, fire and flash.
  const field = new LightField(w, h);
  field.setOpaque(opaque);
  const outdoor = ambientOf(view.time, false), indoor = ambientOf(view.time, true);
  field.reset(i => {
    const cy = Math.floor(i / w), si = at(i - cy * w, cy);
    return si >= 0 && st.indoor[si] ? indoor : outdoor;
  });
  if (view.time !== "night") for (const win of dressing.windows ?? []) {
    const c = L.toCell({ x: win.at[0], y: win.at[1] });
    const k = view.time === "evening" ? 0.35 : view.time === "morning" ? 0.85 : 0.7;
    lights.push({ x: c.x, y: c.y, radius: win.radius / s, color: rgbOf(view.time === "evening" ? "#ffb070" : view.time === "morning" ? "#fff0d0" : "#f8f8ff"), intensity: k });
  }
  for (const l of lights) field.add(l);
  for (let i = 0; i < w * h; i++) {
    const f = canvas.flags[i]!;
    if (f & (GLOW | UNLIT)) continue;
    canvas.bg[i] = shade(canvas.bg[i]!, field, i, f & WALL ? 0.22 : 0);
    // People keep their colour in coloured light and stay findable in the dark (the hidden only keep a floor).
    canvas.fg[i] = f & BEING && !(f & FAINT) ? shadeBeing(canvas.fg[i]!, field.r[i]!, field.g[i]!, field.b[i]!, 0.42, canvas.bg[i]!) : shade(canvas.fg[i]!, field, i, f & BEING ? 0.42 : f & WALL ? 0.3 : 0);
    if (canvas.spec[i]!) canvas.fg[i] = glint(canvas.fg[i]!, field, i, canvas.spec[i]!);
  }

  // The doors, as they came out in the light (for the browser's overlay): which way the wall runs,
  // the side each opens to (where it was authored: doors stand by their walls), how lit, and the floor.
  const isWall = (cx: number, cy: number) => { const si = at(cx, cy); return si >= 0 && !!st.wall[si]; };
  const doorsDrawn: StageDoorPick[] = covered ? drawnDoors.map(({ i, door }) => {
    const cx = i % w, cy = Math.floor(i / w);
    const along = isWall(cx, cy - 1) || isWall(cx, cy + 1) ? "y" : "x";
    const feet = L.toFeet(cx, cy);
    const side = along === "y" ? (door.p.x < feet.x - 1.5 ? -1 : 1) : (door.p.y < feet.y - 1.5 ? -1 : 1);
    const authored = rgbOf(door.look.fg), drawnFg = canvas.fg[i]!;
    const ratio = (k: number) => Math.max(0.12, Math.min(2.2, (((drawnFg >> k) & 255) + 1) / (((authored >> k) & 255) + 1)));
    const light = Math.max(0.35, Math.min(1.05, ratio(16) * 0.3 + ratio(8) * 0.59 + ratio(0) * 0.11));
    const bx = along === "x" ? cx : cx + side, by = along === "x" ? cy + side : cy;
    const floor = canvas.inside(bx, by) ? canvas.bg[by * w + bx]! : canvas.bg[i]!;
    const e = door.e;
    return {
      id: door.id, x: cx, y: cy, along, side, scale: s, look: doorLook(e.states),
      wide: e.size === "large" || e.size === "huge" || e.size === "gargantuan" || /gate|doors\b/i.test(e.name),
      light, floor: hexOf(floor),
    };
  }) : [];

  // The pointer's highlight, in the light (as the map's): everything drawn for whoever or whatever
  // it's on, or the bit of floor.
  if (view.hover !== undefined) {
    // Someone covered by what's in front of them (the rope under Prout) lights up where they are.
    const lit = typeof view.hover === "string" ? (tracked ? cellsFor(tracked, view.hover) : [])
      : canvas.inside(view.hover.x, view.hover.y) ? [view.hover.y * w + view.hover.x] : [];
    for (const i of lit) {
      canvas.bg[i] = mix(canvas.bg[i]!, HOVER, 0.5);
      canvas.fg[i] = mix(canvas.fg[i]!, rgbOf("#ffffff"), 0.25);
      if (covered) covered[i] = 1;
    }
  }

  // 9. Floating text: damage, alerts, barks. Never darkened, never on top of one another (barks
  // first: what people say matters most; numbers find room round them).
  if (fx) {
    const before = covered ? snapshot(canvas) : undefined;
    const taken = new Uint8Array(w * h);
    for (const tx of [...fx.texts].sort((a, b) => (a.style === "bark" ? 0 : 1) - (b.style === "bark" ? 0 : 1))) text(canvas, tx, L, taken, set);
    if (covered && before) changedSince(canvas, before, covered);
  }

  // The lamp posts, for the browser's overlay (src/game/look/lamps.ts): before what stands on the floor counts as covering it.
  if (covered && tracked && view.pick) view.pick.lamps = stageLampsDrawn({ w, h, canvas, field, covered, owner: tracked.owner, ids: tracked.ids, things: order, time: view.time });

  // Whoever and whatever stands on the floor (people, things: drawn in step 4) covers it.
  if (covered && tracked) {
    const standing = new Set(order.map(x => ownerOf.get(x.e.id)).filter((n): n is number => n !== undefined));
    for (let i = 0; i < w * h; i++) if (standing.has(tracked.owner[i]!)) covered[i] = 1;
  }

  // What's where, for the mouse: whose each cell is, and the floor under it (read when asked).
  if (view.pick && tracked) {
    const root = world.entities[world.root]!;
    view.pick.fill(w, h, world.scene, tracked, (cx, cy) => {
      const si = at(cx, cy);
      const feet = L.toFeet(cx, cy);
      if (si < 0) return { at: feet, ground: "void" };
      const ai = st.area[si]!;
      const inside = !!root.rect && feet.x >= root.rect.x && feet.y >= root.rect.y && feet.x < root.rect.x + root.rect.w && feet.y < root.rect.y + root.rect.h;
      const area = ai >= 0 ? st.areas[ai]!.id : inside ? root.id : undefined;
      const wall = st.wall[si] ? WALLS[st.wall[si]! - 1] : undefined;
      const patch = st.patch[si] ? SURFACE_KINDS[st.patch[si]! - 1] : undefined;
      return { at: feet, ground: GROUNDS[st.ground[si]!]!, ...(area ? { area } : {}), ...(wall ? { wall } : {}), ...(st.window[si] ? { window: true } : {}), ...(patch ? { patch } : {}) };
    }, covered ? { doors: doorsDrawn, covered } : undefined);
  }
  return canvas;
}

/** A canvas's cells as they are now, to see what's drawn over them next. */
function snapshot(canvas: Canvas): { glyph: string[]; fg: Int32Array; bg: Int32Array } {
  return { glyph: canvas.glyph.slice(), fg: canvas.fg.slice(), bg: canvas.bg.slice() };
}

/** Mark the cells that changed since a snapshot. */
function changedSince(canvas: Canvas, was: { glyph: string[]; fg: Int32Array; bg: Int32Array }, marks: Uint8Array): void {
  for (let i = 0; i < marks.length; i++) {
    if (canvas.glyph[i] !== was.glyph[i] || canvas.fg[i] !== was.fg[i] || canvas.bg[i] !== was.bg[i]) marks[i] = 1;
  }
}

function rank(x: { e: Entity; look: Look }): number {
  if (x.look.stamp && x.look.footprint) return 0;
  if ((x.look.lift ?? 0) > 0 && !x.look.being) return 2;
  return BURN_RANK(x.e);
}

function put(canvas: Canvas, cx: number, cy: number, cell: TCell): void {
  if (!canvas.inside(cx, cy)) return;
  const i = cy * canvas.w + cx;
  canvas.glyph[i] = cell.glyph;
  canvas.fg[i] = cell.fg;
  canvas.bg[i] = cell.bg;
  canvas.flags[i] = cell.glow ? GLOW : 0;
  canvas.spec[i] = cell.specular ?? 0;
}

/** A footprint in cells for a thing big enough to need one. */
function footprintCells(e: Entity, look: Look, s: number): { w: number; h: number } | undefined {
  if (!look.footprint) return undefined;
  const k = SIZE_SCALE[e.size ?? "large"] ?? 1;
  return { w: Math.max(1, Math.round((look.footprint[0] * k) / s)), h: Math.max(1, Math.round((look.footprint[1] * k) / (2 * s))) };
}

/** One glyph (or a scattered group of them: a flock, a crowd), with a rope above if it hangs. `own` takes each cell drawn for it. */
function drawOne(canvas: Canvas, look: Look, e: Entity, c: { x: number; y: number }, t: number, set: GlyphSet, own?: (i: number) => void): void {
  const alpha = look.alpha ?? 1;
  // Someone you can see stays findable in any light; the hidden stay faint.
  const flags = (look.bold ? BOLD : 0) | (look.glow ? GLOW : 0) | (look.being ? BEING | (alpha < 1 ? FAINT : 0) : 0) | (e.player ? GLOW : 0);
  const n = look.group ?? 1;
  for (let k = 0; k < n; k++) {
    let x = c.x, y = c.y;
    let g = look.glyph, fg = rgbOf(look.fg);
    if (n > 1) {
      // Members spread round the spot, each with its own beat.
      const a = hash01(seedOf(e.id), k, 1) * Math.PI * 2, r = k === 0 ? 0 : 1.2 + hash01(seedOf(e.id), k, 2) * 2.2;
      x = c.x + Math.round(Math.cos(a) * r * 1.6);
      y = c.y + Math.round(Math.sin(a) * r * 0.6);
      const m = lookOf(e, { t, glyphs: set, seed: seedOf(e.id) + k * 101 });
      g = m.glyph; fg = rgbOf(m.fg);
      if (look.role === "crowd") { g = k % 3 === 2 ? inSet("☺", set) : g; fg = scale(fg, 0.85 + 0.3 * hash01(seedOf(e.id), k, 3)); }
      if (m.lift) y -= 1;
    } else if (look.motion === "flutter" && look.lift) y -= 1;
    if (!canvas.inside(x, y)) continue;
    const i = y * canvas.w + x;
    if (alpha < 1) fg = mix(canvas.bg[i]!, fg, alpha);
    if (alpha < 0.35) continue;
    canvas.glyph[i] = g;
    canvas.fg[i] = fg;
    if (look.bg) canvas.bg[i] = rgbOf(look.bg);
    canvas.flags[i] = flags;
    canvas.spec[i] = 0;
    own?.(i);
  }
  if (e.states.includes("hanging") && canvas.inside(c.x, c.y - 1)) {
    const sway = noise1(t / 1300, seedOf(e.id)) > 0.5;
    canvas.put(c.x, c.y - 1, inSet(sway ? "│" : "╎", set), rgbOf("#c8a878"));
    own?.((c.y - 1) * canvas.w + c.x);
  }
}

/** Big things over several cells: a tabletop, the bar's hull, the hearth, the elm's canopy, a stack of sacks. `own` takes each cell drawn for it. */
function stamp(canvas: Canvas, look: Look, e: Entity, c: { x: number; y: number }, fp: { w: number; h: number }, t: number, tctx: TerrainContext, own?: (i: number) => void): void {
  const set = tctx.glyphs ?? "ascii";
  const x0 = c.x - Math.floor(fp.w / 2), y0 = c.y - Math.floor(fp.h / 2);
  const fg = rgbOf(look.fg);
  const seed = seedOf(e.id);
  const burning = look.burning ?? 0;
  const flame: FlameName = look.flame ?? "fire";
  const g = (ch: string) => inSet(ch, set);
  const wreck = !!look.wreck;
  if (look.stamp === "canopy" && !wreck && tctx.time !== "night" && tctx.time !== "evening") {
    // A tree throws its shadow down and to the right in daylight (the sun is up and to the left).
    const sx = Math.max(2, Math.round(fp.w * 0.18)), sy = Math.max(1, Math.round(fp.h * 0.22));
    for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) {
      const nx = (dx + 0.5) / fp.w * 2 - 1, ny = (dy + 0.5) / fp.h * 2 - 1;
      if (Math.hypot(nx, ny) > 0.95) continue;
      const x = x0 + dx + sx, y = y0 + dy + sy;
      if (!canvas.inside(x, y)) continue;
      const i = y * canvas.w + x;
      if (canvas.flags[i]! & (WALL | GLOW)) continue;
      canvas.bg[i] = scale(canvas.bg[i]!, 0.62); canvas.fg[i] = scale(canvas.fg[i]!, 0.7);
    }
  }
  for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (!canvas.inside(x, y)) continue;
    const i = y * canvas.w + x;
    const r = hash01(x, y, seed);
    const edgeX = dx === 0 || dx === fp.w - 1, edgeY = dy === 0 || dy === fp.h - 1;
    let glyph = look.glyph, f = fg, b: RGB | undefined = canvas.bg[i];
    if (wreck) {
      // What's left: a scatter of char or rubble over most of where it stood.
      if (r < 0.3) continue;
      glyph = g(r < 0.55 ? look.glyph : r < 0.75 ? "," : "∙");
      f = scale(fg, 0.75 + 0.5 * r);
      if (look.burning || e.states.includes("smouldering")) {
        const ember = noise3(x * 0.7, y, t / 500, seed) > 0.62;
        if (ember) { f = ramp(FLAME_RAMPS.ember, 0.5 + 0.5 * noise1(t / 200, seed + dx)); canvas.flags[i] = GLOW; }
      }
      canvas.glyph[i] = glyph; canvas.fg[i] = f;
      own?.(i);
      continue;
    }
    switch (look.stamp) {
      case "top": b = scale(fg, 0.52); f = scale(fg, 0.9); glyph = edgeX ? g(dx === 0 ? "▐" : "▌") : r < 0.55 ? g("═") : g("─"); if (edgeX) { f = scale(fg, 0.62); b = canvas.bg[i]; } break;
      case "bench": glyph = g("═"); f = fg; break;
      case "hull": b = rgbOf("#1e1a16"); f = rgbOf("#5a4c3c"); glyph = dx === 0 ? g("◄") : dx === fp.w - 1 ? g("►") : edgeY && fp.h > 1 ? g("▀") : r < 0.5 ? g("═") : g("─"); if (dx === 0 || dx === fp.w - 1) { b = canvas.bg[i]; f = rgbOf("#3e342a"); } break;
      case "block": b = scale(fg, 0.55); f = scale(fg, 1.1); glyph = dy === 0 ? g("▀") : r < 0.15 ? g("·") : g(" "); break;
      case "stack": {
        // Sacks stacked in rows: each row a course of sacks (a darker seam between), the odd tie showing.
        const seam = (dx + (dy & 1) * 2) % 4 === 0;
        b = scale(fg, seam ? 0.3 : 0.42 + 0.08 * r); f = scale(fg, 0.62 + 0.18 * r);
        glyph = seam ? g("│") : r < 0.16 ? g("δ") : r < 0.5 ? g("▒") : g("░");
        break;
      }
      case "bed": b = scale(fg, 0.6); f = rgbOf("#e8e0d0"); glyph = dy === 0 ? g("▀") : g("░"); break;
      case "line": glyph = g("▒"); b = scale(fg, 0.5); break;
      case "canopy": {
        // An ellipse of leaves with a ragged, airy edge: lit from the upper left, in shade to the
        // lower right, gusts running through it downwind.
        const nx = (dx + 0.5) / fp.w * 2 - 1, ny = (dy + 0.5) / fp.h * 2 - 1;
        const d = Math.hypot(nx, ny) + (noise2(x * 0.5, y * 0.8, seed) - 0.5) * 0.5;
        if (d > 1 || (d > 0.7 && r < 0.22)) continue;
        const wind = tctx.wind ?? { dir: 0.4, strength: 0.5 };
        const gust = smoothstep(0.5, 0.85, noise2(x * 0.12 - t / 1000 * (0.7 + wind.strength), y * 0.3, seed + 5)) * (0.4 + 0.6 * wind.strength);
        const dark = rgbOf(look.role === "pine" ? "#163a1e" : "#1c3a16"), light = rgbOf(look.role === "pine" ? "#4a8a50" : "#7aaa44");
        const sun = clamp01(0.55 - (nx + ny) * 0.38 + (1 - d) * 0.25);
        glyph = r < 0.55 ? look.glyph : r < 0.8 ? g(look.role === "pine" ? "♠" : "♣") : g(gust > 0.4 ? "'" : "\"");
        f = mix(mix(dark, light, sun * (0.6 + 0.4 * r)), rgbOf("#c8e0a0"), gust * 0.5);
        b = mix(rgbOf("#0c1a0a"), rgbOf("#1c3612"), sun * 0.8);
        if (d > 0.82) b = mix(canvas.bg[i]!, b, 0.55);
        if (burning > 0) {
          const heat = noise3(x * 0.35, y * 0.7 + t / 260, t / 500, seed + 9) * (0.6 + burning * 0.6);
          if (heat > 0.42) {
            const fl = FLAME_RAMPS[flame];
            glyph = g(heat > 0.72 ? "▲" : heat > 0.56 ? "^" : "*");
            f = ramp(fl, clamp01(0.35 + heat * 0.6)); b = ramp(fl, clamp01(0.08 + heat * 0.28));
            canvas.glyph[i] = glyph; canvas.fg[i] = f; canvas.bg[i] = b; canvas.flags[i] = GLOW | BOLD; canvas.spec[i] = 0;
            own?.(i);
            continue;
          }
          f = mix(f, rgbOf("#3a2a1a"), 0.5);
        }
        break;
      }
      case "hearth": {
        // A stone surround; the fire in it (or cold ash).
        const rim = edgeX || dy === fp.h - 1 || dy === 0;
        if (rim) { glyph = g(r < 0.6 ? "▓" : "▒"); f = rgbOf("#6a6560"); b = rgbOf("#3a3632"); break; }
        if (burning > 0) {
          const cell = flameCell(flame, { glyph: " ", fg: rgbOf("#2a1a10"), bg: rgbOf("#1a1008") }, x, y, burning, { ...tctx, seed });
          canvas.glyph[i] = cell.glyph; canvas.fg[i] = cell.fg; canvas.bg[i] = cell.bg; canvas.flags[i] = GLOW | BOLD; canvas.spec[i] = 0;
          own?.(i);
          continue;
        }
        glyph = g(r < 0.4 ? "∙" : r < 0.6 ? "," : " "); f = rgbOf("#5a5450"); b = rgbOf("#1c1a18");
        break;
      }
      default: break;
    }
    if (burning > 0 && look.stamp !== "canopy" && look.stamp !== "hearth") {
      // A burning table: flames run over it, the wood showing between them.
      const cell = flameCell(flame, { glyph, fg: f, bg: b ?? canvas.bg[i]! }, x, y, burning * (0.7 + 0.3 * noise2(dx * 0.6, dy, seed)), { ...tctx, seed });
      canvas.glyph[i] = cell.glyph; canvas.fg[i] = cell.fg; canvas.bg[i] = cell.bg; canvas.flags[i] = cell.glow ? GLOW | BOLD : 0; canvas.spec[i] = 0;
      own?.(i);
      continue;
    }
    canvas.glyph[i] = glyph; canvas.fg[i] = f;
    if (b !== undefined) canvas.bg[i] = b;
    canvas.flags[i] = look.bold ? BOLD : 0;
    canvas.spec[i] = 0;
    own?.(i);
  }
}

// ---------------------------------------------------------------------------------------------
// Ambient life: stateless emitters (a particle per beat, its fate decided by a hash).

interface Emitter { kind: "fire" | "smoulder" | "steam" | "dust" | "zzz"; x: number; y: number; w: number; h: number; seed: number; strength: number; flame: FlameName }

const EMBERS = FLAME_RAMPS.fire;
function emit(canvas: Canvas, em: Emitter, t: number, set: GlyphSet, wind?: { dir: number; strength: number }): void {
  const windX = wind ? Math.cos(wind.dir) * wind.strength : 0.2;
  const beat = (period: number, life: number, fn: (j: number, age: number, f: number) => void) => {
    const first = Math.floor((t - life) / period), last = Math.floor(t / period);
    for (let j = first; j <= last; j++) {
      const age = t - j * period;
      if (age < 0 || age > life) continue;
      fn(j, age, age / life);
    }
  };
  const g = (ch: string) => inSet(ch, set);
  const at = (x: number, y: number) => (canvas.inside(x, y) ? y * canvas.w + x : -1);
  switch (em.kind) {
    case "fire": {
      // Embers rise from the flames and wink out; smoke rises above them and drifts downwind.
      const spread = Math.max(1, em.w);
      beat(Math.max(30, 140 / Math.sqrt(spread)), 1100, (j, age, f) => {
        if (hash01(em.seed, j, 1) > 0.55 * em.strength + 0.2) return;
        const x = Math.round(em.x + (hash01(em.seed, j, 2) - 0.5) * spread + windX * f * 4 + Math.sin(age / 180 + j) * 0.6);
        const y = Math.round(em.y - (age / 1000) * (3 + hash01(em.seed, j, 3) * 4) - em.h / 2);
        const i = at(x, y);
        if (i < 0) return;
        canvas.glyph[i] = g(f < 0.3 ? "*" : f < 0.6 ? "'" : "·");
        canvas.fg[i] = ramp(em.flame === "fire" ? EMBERS : FLAME_RAMPS[em.flame], clamp01(0.95 - f * 0.8));
        canvas.flags[i] = GLOW;
      });
      beat(Math.max(60, 260 / Math.sqrt(spread)), 3200, (j, age, f) => {
        if (hash01(em.seed, j, 4) > 0.75) return;
        const x = Math.round(em.x + (hash01(em.seed, j, 5) - 0.5) * spread * 0.8 + windX * f * 9 + noise1(age / 600, em.seed + j) * 2 - 1);
        const y = Math.round(em.y - em.h / 2 - 1 - (age / 1000) * (1.6 + hash01(em.seed, j, 6) * 1.4));
        const i = at(x, y);
        if (i < 0) return;
        const k = (1 - f) * 0.55;
        canvas.bg[i] = mix(canvas.bg[i]!, rgbOf("#4a4650"), k);
        canvas.fg[i] = mix(canvas.fg[i]!, rgbOf("#8a8690"), k * 0.8);
        if (k > 0.3 && !(canvas.flags[i]! & GLOW)) canvas.glyph[i] = g(f < 0.35 ? "▒" : "░");
      });
      break;
    }
    case "smoulder":
      beat(420, 2600, (j, age, f) => {
        if (hash01(em.seed, j, 7) > 0.6) return;
        const x = Math.round(em.x + (hash01(em.seed, j, 8) - 0.5) * em.w + windX * f * 5);
        const y = Math.round(em.y - 1 - (age / 1000) * 1.3);
        const i = at(x, y);
        if (i < 0) return;
        const k = (1 - f) * 0.4;
        canvas.bg[i] = mix(canvas.bg[i]!, rgbOf("#4a4650"), k);
        canvas.fg[i] = mix(canvas.fg[i]!, rgbOf("#7a7680"), k);
        if (k > 0.25) canvas.glyph[i] = g("░");
      });
      break;
    case "steam":
      beat(380, 1800, (j, age, f) => {
        if (hash01(em.seed, j, 9) > 0.55) return;
        const x = Math.round(em.x + (hash01(em.seed, j, 10) - 0.5) * em.w + Math.sin(age / 300 + j) * 0.7);
        const y = Math.round(em.y - 1 - (age / 1000) * 2.2);
        const i = at(x, y);
        if (i < 0) return;
        const k = (1 - f) * 0.45;
        canvas.fg[i] = mix(canvas.fg[i]!, rgbOf("#e8eef4"), k);
        if (k > 0.2) canvas.glyph[i] = g(f < 0.4 ? "░" : "·");
      });
      break;
    case "dust": {
      // Motes drifting in the air of a dusty place; they show where the light catches them.
      const count = Math.max(6, Math.round(em.w * em.h * 0.06));
      for (let k = 0; k < count; k++) {
        const x = Math.round(em.x + ((hash01(em.seed, k, 11) * em.w + (t / 1000) * 0.3 * (hash01(em.seed, k, 12) - 0.3) * 3 + noise1(t / 2500, em.seed + k) * 3) % Math.max(1, em.w)));
        const y = Math.round(em.y + ((hash01(em.seed, k, 13) * em.h + noise1(t / 3100, em.seed + k + 50) * 2) % Math.max(1, em.h)));
        const i = at(x, y);
        if (i < 0) continue;
        const tw = noise1(t / 400, em.seed + k * 7);
        if (tw < 0.35) continue;
        canvas.glyph[i] = g(tw > 0.75 ? "∙" : "·");
        canvas.fg[i] = mix(rgbOf("#8a7a54"), rgbOf("#f0e0a8"), tw);
      }
      break;
    }
    case "zzz":
      beat(1100, 1700, (_j, age, f) => {
        const x = Math.round(em.x + 1 + f * 1.5), y = Math.round(em.y - 1 - (age / 1000) * 1.4);
        const i = at(x, y);
        if (i < 0) return;
        canvas.glyph[i] = f < 0.5 ? "z" : "Z";
        canvas.fg[i] = mix(rgbOf("#c8c8e8"), rgbOf("#6a6a88"), f);
        canvas.flags[i] = 0;
      });
      break;
  }
}

function sprite(canvas: Canvas, sp: { x: number; y: number; z: number; glyph: string; fg: RGB; bg?: RGB; bgAlpha?: number; alpha: number; glow: boolean }, L: StageLayout, s: number, set: GlyphSet): void {
  const c = L.toCell(sp);
  const x = c.x, y = c.y - Math.round(sp.z / (2 * s));
  if (!canvas.inside(x, y)) return;
  const i = y * canvas.w + x;
  if (sp.bg !== undefined) {
    // Translucent (smoke, steam, dust): veil the cell; only the thicker part of a puff draws its wisp.
    const k = (sp.bgAlpha ?? 0.5) * sp.alpha;
    canvas.bg[i] = mix(canvas.bg[i]!, sp.bg, k);
    if (k > 0.18) { canvas.glyph[i] = inSet(sp.glyph, set); canvas.fg[i] = mix(canvas.bg[i]!, sp.fg, Math.min(1, k * 2.2)); }
    else canvas.fg[i] = mix(canvas.fg[i]!, sp.fg, k);
  } else {
    canvas.glyph[i] = inSet(sp.glyph, set);
    canvas.fg[i] = sp.alpha < 1 ? mix(canvas.bg[i]!, sp.fg, sp.alpha) : sp.fg;
  }
  if (sp.glow) canvas.flags[i] = (canvas.flags[i]! & BOLD) | GLOW;
}

/** Floating text: barks in a dark bubble with the speaker's colour down the side, numbers rising. */
function text(canvas: Canvas, tx: { x: number; y: number; rows: number; text: string; fg: RGB; bg?: RGB; alpha: number; style: string; bold: boolean }, L: StageLayout, taken: Uint8Array, set: GlyphSet): void {
  if (tx.alpha <= 0.02) return;
  const c = L.toCell(tx);
  const parchment = rgbOf("#efe6d2");
  // The nearest rows (up first, then down) where a span of cells is free of other text.
  const free = (left: number, top: number, width: number, height: number): number => {
    for (const shift of [0, -1, -2, 1, -3, 2, -4]) {
      let ok = true;
      for (let y = top + shift; y < top + shift + height && ok; y++) for (let x = left; x < left + width; x++) if (canvas.inside(x, y) && taken[y * canvas.w + x]) { ok = false; break; }
      if (ok) return top + shift;
    }
    return top;
  };
  const claim = (left: number, top: number, width: number, height: number) => { for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) if (canvas.inside(x, y)) taken[y * canvas.w + x] = 1; };
  const body = set === "plain" ? plainText(tx.text) : tx.text;
  if (tx.style === "bark") {
    const lines = wrap(body, 28);
    const width = Math.max(...lines.map(l => [...l].length)) + 3;
    const left = Math.max(0, Math.min(canvas.w - width, c.x - Math.floor(width / 2)));
    const top = Math.max(0, free(left, c.y - Math.round(tx.rows) - lines.length + 1, width, lines.length));
    claim(left, top, width, lines.length);
    const bg = tx.bg ?? rgbOf("#16141c");
    lines.forEach((line, k) => {
      const y = Math.max(0, top + k);
      const row = `${inSet("▌", set)}${line.padEnd(width - 2)} `;
      [...row].forEach((ch, j) => {
        const x = left + j;
        if (!canvas.inside(x, y)) return;
        const i = y * canvas.w + x;
        const under = canvas.bg[i]!;
        canvas.glyph[i] = ch;
        canvas.bg[i] = mix(under, bg, Math.min(1, tx.alpha * 1.1));
        canvas.fg[i] = mix(canvas.bg[i]!, j === 0 ? tx.fg : parchment, tx.alpha);
        canvas.flags[i] = UNLIT;
      });
    });
    // The tail, pointing down at whoever's talking: not into another bark, and none comes over it.
    const ty = top + lines.length;
    if (canvas.inside(c.x, ty) && ty < c.y && !taken[ty * canvas.w + c.x]) { const i = ty * canvas.w + c.x; canvas.glyph[i] = inSet("▾", set); canvas.fg[i] = mix(canvas.bg[i]!, tx.fg, tx.alpha); canvas.flags[i] = UNLIT; taken[i] = 1; }
    return;
  }
  const chars = [...body];
  const left = Math.max(0, Math.min(canvas.w - chars.length, c.x - Math.floor(chars.length / 2)));
  const y = free(left, c.y - Math.round(tx.rows), chars.length, 1);
  claim(left, y, chars.length, 1);
  chars.forEach((ch, j) => {
    const x = left + j;
    if (!canvas.inside(x, y)) return;
    const i = y * canvas.w + x;
    canvas.glyph[i] = ch;
    canvas.fg[i] = mix(canvas.bg[i]!, tx.fg, tx.alpha);
    if (tx.style === "damage" || tx.style === "heal" || tx.style === "alert") canvas.bg[i] = mix(canvas.bg[i]!, rgbOf("#0e0c10"), 0.55 * tx.alpha);
    canvas.flags[i] = UNLIT | (tx.bold ? BOLD : 0);
  });
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = ""; }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Hash helper re-exported for dressings that want stable variety. */
export const stableHash = hash;
