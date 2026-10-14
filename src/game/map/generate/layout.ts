import type { Tile2 } from "../../types.ts";
import { tile, type MapTile } from "../tiles.ts";
import type { Problem } from "./normalize.ts";
import { dir } from "./orient.ts";
import { SIDES, type Corner, type DoorPlan, type FloorKind, type Ground, type OutsidePlan, type PlacePlan, type RoomPlan, type Side, type WallKind } from "./plan.ts";

/**
 * Laying a (turned, normalized) plan out on 5-ft tiles: the building's footprint, its rooms carved
 * out of it (each room on its side or in its corner, the main room taking what's left), doors on
 * the walls between what they join, windows along outside walls, and the outside in strips along
 * the building (the street, a quay, a walk on piles, the river with a boat in it), nearest first.
 *
 * The rooms are rectangles anchored to the building's sides and corners with a wall between each
 * and the next: a small BSP in effect, but driven by where the plan says each room is rather than
 * by random cuts, so "the back room on the north side" is on the north side. A seed varies what the
 * plan leaves open, so two runs of one plan aren't the same building: which end of its side a room
 * takes, where along its wall a door goes, and sometimes a back corner left out of the footprint, so
 * the building is an L.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface AreaInfo {
  id: string;
  name: string;
  description: string;
  /** Inside the building (a room) or outside it. */
  room: boolean;
  /** Its walkable tiles (map coordinates). */
  tiles: Tile2[];
  bbox: Rect;
  /** Its whole extent: a room's floor, a strip of street or river (the deep water too), a boat's deck. */
  rect: Rect;
  /** Outside: the side of the building it's on (a boat: the side of its water). */
  side?: Side;
  ground: string;
  boat?: boolean;
}

export interface DoorInfo {
  id: string;
  plan: DoorPlan;
  at: Tile2;
  /** The tiles either side: in `from` and in `to`. */
  inside: Tile2;
  outside: Tile2;
  from: string;
  to: string;
  /** The side of `from` the door is on (for a door to outside, the building's side). */
  side: Side;
}

export interface Site {
  width: number;
  height: number;
  tiles: MapTile[][];
  /** Area id per tile (y * width + x), for walkable tiles that belong to an area. */
  area: Array<string | undefined>;
  areas: Map<string, AreaInfo>;
  doors: DoorInfo[];
  windows: Array<{ at: Tile2; room: string; side: Side }>;
  /** The building's bounding box, walls included. */
  building: Rect;
  /** A back corner left out of the building (it's an L), walls not included. */
  notch?: Rect;
  /** The look of its walls and roof, and their height. */
  style: string;
  wallHeight: number;
  /** Edge tiles of the street, where you walk off the map. */
  exits: Tile2[];
  /** The door the place is entered by. */
  entrance?: DoorInfo;
  problems: Problem[];
  notes: string[];
}

export const DIR: Record<Side, Tile2> = { north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 } };
export const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };
export const add = (a: Tile2, b: Tile2, k = 1): Tile2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const tkey = (t: Tile2) => `${t.x},${t.y}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const tilesOf = (feet: number) => Math.round(feet / 5);
/** The smallest room, in squares each way: two is a corridor, and a door in each wall fills it. */
const MIN_ROOM = 3;
/** The main room has room in it this many squares each way, whatever the others take. */
const MAIN_MIN = 5;
/** The biggest building, in squares each way. */
const MAX_SIDE = 26;
/**
 * Walls between rooms are drawn two rows high, whatever the storeys: from above (a scene's view,
 * roofs off) a full-height partition would hide the two squares behind it, and a room nobody is
 * in would be a block of wall. The Heron's counting-box is built the same way.
 */
const PARTITION = 2;

/** Walls and roofs by what they're made of: the renderer's block styles. */
export const WALL_STYLE: Record<WallKind, string> = { stone: "civic", brick: "brick", timber: "timber", "tarred-timber": "tar", plaster: "plaster", "earth-bank": "bank", "fine-stone": "palace" };
/**
 * The walls themselves, when they aren't what the roof is: a burrow in a bank is timber-walled
 * inside the bank, as the Rat is (a turf roof, timber walls, the bank all round). A fire lights the
 * walls of its room, and turf there would look like the firelight was out on the bank.
 */
const WALLS_OF: Partial<Record<WallKind, string>> = { "earth-bank": "timber" };
const PARTITIONS: Partial<Record<WallKind, string>> = { "earth-bank": "timber", "fine-stone": "gilt" };

/** How far out a strip of each kind of ground goes, at most, in squares (things in it get more room). */
const STRIP_DEPTH: Record<Ground, number> = { cobbles: 3, boards: 3, "planks-over-water": 2, dirt: 3, grass: 3, steps: 2, water: 3, boat: 0 };
/** How far out all a side's strips go together, at most (a boat's berth besides). */
const SIDE_DEPTH = 6;

/** An indoor floor tile of a kind, under a roof. */
export function floorTile(kind: FloorKind, roof: string, roofHeight: number): MapTile {
  const r = { roof, roofHeight };
  switch (kind) {
    case "boards": return tile("boards", r);
    case "flagstones": return tile("floor", { style: "flags", ...r });
    case "earth": return tile("dirt", r);
    case "carpet": return tile("floor", { style: "carpet", ...r });
    default: return tile("floor", r);
  }
}

function groundTile(ground: Ground, row: number): MapTile {
  switch (ground) {
    case "cobbles": return tile("cobbles");
    case "boards": return tile("boards");
    case "planks-over-water": return tile("bridge");
    case "dirt": return tile("dirt");
    case "grass": return tile("grass");
    case "steps": return tile("stairs");
    // The river: shallows along its edge, then deep (and fast, and cold).
    case "water": return row === 0 ? tile("water") : tile("deep-water");
    case "boat": return tile("boards");
  }
}

const walkable = (t: MapTile) => !t.blocks && t.terrain !== "wall" && t.terrain !== "window" && t.terrain !== "fence" && t.terrain !== "void";

/** A small deterministic random source (mulberry32): the same seed, the same building. */
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

/** A seed from a string (a place's id). */
export const seedOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);

export interface LayoutOptions {
  /** Varies what the plan leaves open (default 1). */
  seed?: number;
  /**
   * The things on the floor to size the building for, at least (default 16): a building laid out
   * from its rooms before its things have arrived (a streaming plan's shell) is then the same
   * building as the furnished one, unless it has more than that.
   */
  expectThings?: number;
}

export function layout(plan: PlacePlan, options: LayoutOptions = {}): Site {
  const seed = options.seed ?? 1;
  const notes: string[] = [];
  // The footprint, grown if the rooms and things wouldn't fit in it.
  let W = clamp(tilesOf(plan.width), 5, MAX_SIDE), D = clamp(tilesOf(plan.depth), 5, MAX_SIDE);
  const onFloor = plan.things.filter(t => !["on", "in", "under", "overhead"].includes(t.relation) && plan.rooms.some(r => r.id === t.in));
  // Each room as asked (with its walls), and on the main floor a square or two per thing to stand
  // on and get round it, so the main room isn't all furniture.
  const need = plan.rooms.filter(r => r.where !== "main").reduce((n, r) => n + Math.max(MIN_ROOM, tilesOf(r.width)) * Math.max(MIN_ROOM, tilesOf(r.depth)) + 4, 0)
    + Math.max(onFloor.reduce((n, t) => n + 2 * (t.size === "huge" ? 3 : Math.max(1, t.tiles)), 0), 2 * (options.expectThings ?? 16)) + Math.max(3, plan.people.length) + 9;
  const asked = { W, D };
  if ((W - 2) * (D - 2) < need) {
    const k = Math.min(1.5, Math.sqrt(need / ((W - 2) * (D - 2))));
    W = clamp(Math.ceil(W * k), 5, MAX_SIDE); D = clamp(Math.ceil(D * k), 5, MAX_SIDE);
  }
  // Deep enough for the rooms on each side and a main room of five squares between them.
  const into = (s: Side) => Math.max(0, ...plan.rooms.filter(r => r.where !== "main" && r.where.split("-").includes(s))
    .map(r => Math.max(MIN_ROOM, s === "north" || s === "south" ? tilesOf(r.depth) : tilesOf(r.width)) + 1));
  W = clamp(Math.max(W, into("west") + into("east") + MAIN_MIN + 2), 7, MAX_SIDE);
  D = clamp(Math.max(D, into("north") + into("south") + MAIN_MIN + 2), 7, MAX_SIDE);

  // Sometimes a back corner is left out, if no room wants it and the main room keeps its five
  // squares each way: the building is an L.
  const rand = rng(seed);
  const used = new Set(plan.rooms.filter(r => r.where !== "main").flatMap(r => r.where.split("-")));
  const free = (["north-east", "north-west", "south-east"] as Corner[]).filter(c => !plan.rooms.some(r => r.where === c) && c.split("-").every(s => !used.has(s)));
  let notch: Corner | undefined = rand() < 0.45 && free.length ? free[Math.floor(rand() * free.length)] : undefined;

  // The main room needs its five squares each way; if the rooms took them, grow and lay it out again.
  for (let attempt = 0; ; attempt++) {
    const site = layoutOnce(plan, W, D, notch, seed);
    const roomy = mainIsRoomy(site, plan);
    if (roomy || attempt >= 5) {
      if (W !== asked.W || D !== asked.D) site.notes.unshift(`The building (${asked.W * 5} by ${asked.D * 5} ft) was too small for its ${plan.rooms.length} rooms and ${onFloor.length} things on the floor: grown to ${W * 5} by ${D * 5} ft.`);
      site.notes.push(...notes);
      return site;
    }
    if (notch) { notch = undefined; continue; }
    W = Math.min(MAX_SIDE, W + 1); D = Math.min(MAX_SIDE, D + 1);
  }
}

/** Does the main room have five clear squares each way somewhere? */
function mainIsRoomy(site: Site, plan: PlacePlan): boolean {
  const main = plan.rooms.find(r => r.where === "main");
  const a = main && site.areas.get(main.id);
  if (!a) return false;
  const inMain = new Set(a.tiles.map(tkey));
  return a.tiles.some(p => {
    for (let dy = 0; dy < MAIN_MIN; dy++) for (let dx = 0; dx < MAIN_MIN; dx++) if (!inMain.has(tkey({ x: p.x + dx, y: p.y + dy }))) return false;
    return true;
  });
}

function layoutOnce(plan: PlacePlan, W: number, D: number, notchCorner: Corner | undefined, seed: number): Site {
  const problems: Problem[] = [];
  const notes: string[] = [];
  const rand = rng(seed ^ 0x5bd1e995);
  const style = WALL_STYLE[plan.walls];
  // What the walls are built of (a burrow's are timber, in the bank); the roof is the building's style.
  const walls = WALLS_OF[plan.walls] ?? style;
  // Walls between rooms: panelling (as the Heron's counting-box is), timber in a burrow, gilt in a palace.
  const partition = PARTITIONS[plan.walls] ?? "panel";
  // Rows high: a burrow or a house of one storey 2 (as the Rat is: its walls don't swallow a small
  // room in the scene view), of two 3 (an upper floor is the roof's pitch, as the town draws it),
  // anything taller 4 (the Heron).
  const wallHeight = plan.walls === "earth-bank" || plan.storeys <= 1 ? 2 : plan.storeys >= 3 ? 4 : 3;
  const behind = (s: Side) => s === "north" || s === "east";
  const shadow = Math.floor(wallHeight / 2);

  // The outside: strips along each side, nearest first, no deeper than they need to be (a street
  // of three squares, a river of three, more for what stands in them); boats go in their water.
  const strips: Record<Side, Array<{ o: OutsidePlan; depth: number }>> = { north: [], east: [], south: [], west: [] };
  const boats: OutsidePlan[] = [];
  const thingsIn = (id: string) => plan.things.filter(t => t.in === id && !["on", "in", "under", "overhead"].includes(t.relation)).length + plan.people.filter(p => p.in === id).length;
  for (const o of plan.outside) {
    if (o.ground === "boat") { boats.push(o); continue; }
    const most = STRIP_DEPTH[o.ground] + Math.min(3, Math.ceil(thingsIn(o.id) / 3));
    strips[o.side].push({ o, depth: clamp(tilesOf(o.depth), 1, most) });
  }
  const boatBerths: Array<{ boat: OutsidePlan; water: OutsidePlan; beam: number }> = [];
  for (const boat of boats) {
    const onSide = strips[boat.side].filter(s => s.o.ground === "water");
    const water = onSide.at(-1) ?? SIDES.flatMap(s => strips[s]).find(s => s.o.ground === "water");
    if (!water) {
      problems.push({ check: "plan", subject: boat.id, message: `${boat.name} is a boat but there's no water outside for it to float in: add the river (ground water) on its side.`, severity: "error" });
      continue;
    }
    // A deck of a square or two between its rails, like the Heron's barge.
    const beam = clamp(tilesOf(boat.depth) - 1, 1, 2);
    // A row of water between the bank and the boat; more behind the building, out of its shadow.
    const off = behind(water.o.side) ? shadow + 1 : 1;
    water.depth = Math.max(water.depth, off + beam + 2 + 1);
    boatBerths.push({ boat, water: water.o, beam });
  }
  // However many strips a side has (a quay, the stairs, a landing, the river), the outside doesn't
  // outgrow the building: the ground gives way first, the outermost first, down to a square each;
  // then the water, down to its shallows and a row of deep (or a boat's berth).
  for (const side of SIDES) {
    const berth = Math.max(0, ...boatBerths.filter(b => b.water.side === side).map(b => (behind(side) ? shadow + 1 : 1) + b.beam + 3));
    const total = () => strips[side].reduce((n, x) => n + x.depth, 0);
    for (const water of [false, true]) {
      for (const s of [...strips[side]].reverse()) {
        if ((s.o.ground === "water") !== water || total() <= SIDE_DEPTH + berth) continue;
        const least = boatBerths.some(b => b.water.id === s.o.id) ? berth : water ? 2 : 1;
        s.depth = Math.max(least, s.depth - (total() - SIDE_DEPTH - berth));
      }
    }
  }
  const extent = (s: Side) => strips[s].reduce((n, x) => n + x.depth, 0);
  // A square of ground on a side with nothing there; behind, among buildings, the neighbours, two
  // squares deep so they read as houses, not a fence.
  const margin = (s: Side) => (strips[s].length ? 0 : plan.surroundings === "buildings" && behind(s) ? 2 : 1);
  const west = extent("west") + margin("west"), east = extent("east") + margin("east");
  const north = extent("north") + margin("north"), south = extent("south") + margin("south");
  const width = west + W + east, height = north + D + south;
  const building: Rect = { x: west, y: north, w: W, h: D };
  // The corner left out: a third of each side, leaving the main room its five squares each way.
  const notch: Rect | undefined = notchCorner ? (() => {
    const nw = clamp(Math.round(W * (0.3 + 0.1 * rand())), 3, W - MAIN_MIN - 3), nh = clamp(Math.round(D * (0.3 + 0.1 * rand())), 3, D - MAIN_MIN - 3);
    if (W - nw < MAIN_MIN + 3 || D - nh < MAIN_MIN + 3 || nw < 3 || nh < 3) return undefined;
    const [ns, ew] = notchCorner.split("-") as [Side, Side];
    return { x: ew === "east" ? building.x + W - nw : building.x, y: ns === "north" ? building.y : building.y + D - nh, w: nw, h: nh };
  })() : undefined;
  const inRect = (p: Tile2, r: Rect) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
  const inBuilding = (p: Tile2) => inRect(p, building) && !(notch && inRect(p, notch));

  const tiles: MapTile[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => tile("void")));
  const area: Array<string | undefined> = new Array(width * height).fill(undefined);
  const areas = new Map<string, AreaInfo>();
  const set = (p: Tile2, t: MapTile, id?: string) => { tiles[p.y]![p.x] = t; area[p.y * width + p.x] = id && walkable(t) ? id : undefined; };

  // Surroundings first, then the strips over them.
  const entranceArea = plan.outside.find(o => o.ground !== "water" && o.ground !== "boat") ?? plan.outside[0]!;
  const open = groundTile(entranceArea.ground === "steps" ? "dirt" : entranceArea.ground === "planks-over-water" ? "boards" : entranceArea.ground, 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = { x, y };
    if (inBuilding(p)) continue;
    // Neighbours stand behind (north and east, along the building): in front they'd hide it.
    const back = (y < building.y && x >= building.x && x < building.x + W) || (x >= building.x + W && y >= building.y && y < building.y + D);
    const corner = notch && inRect(p, notch);
    switch (plan.surroundings) {
      case "earth-bank": set(p, tile("wall", { style: "bank", height: 2 })); break;
      case "water": set(p, corner ? { ...open } : tile("deep-water")); break;
      case "buildings": set(p, back && !corner ? tile("wall", { style: style === "brick" ? "plaster" : "brick", height: 3 }) : { ...open }); break;
      default: set(p, { ...open });
    }
  }
  // Strips run along the building's side and a square past each corner, so you can walk round it;
  // where two meet at a corner, the one you can walk on has it.
  const stripRects = new Map<string, Rect>();
  const claimed = new Map<string, OutsidePlan>();
  for (const side of SIDES) {
    let offset = 0;
    for (const { o, depth } of strips[side]) {
      const across = side === "north" || side === "south";
      const lo = across ? Math.max(0, building.x - 1) : Math.max(0, building.y - 1);
      const hi = across ? Math.min(width, building.x + W + 1) : Math.min(height, building.y + D + 1);
      const r: Rect = side === "north" ? { x: lo, y: building.y - offset - depth, w: hi - lo, h: depth }
        : side === "south" ? { x: lo, y: building.y + D + offset, w: hi - lo, h: depth }
        : side === "west" ? { x: building.x - offset - depth, y: lo, w: depth, h: hi - lo }
        : { x: building.x + W + offset, y: lo, w: depth, h: hi - lo };
      stripRects.set(o.id, r);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const k = tkey({ x, y });
        const had = claimed.get(k);
        if (had && (had.ground !== "water" || o.ground === "water")) continue;
        claimed.set(k, o);
        // Water's shallow edge is the row nearest the building.
        const row = side === "north" ? r.y + r.h - 1 - y : side === "south" ? y - r.y : side === "west" ? r.x + r.w - 1 - x : x - r.x;
        set({ x, y }, groundTile(o.ground, row), o.id);
      }
      offset += depth;
    }
  }

  // Boats: a hull rail round a deck, in their water, with a gangplank to the bank.
  for (const { boat, water, beam } of boatBerths) {
    const r = stripRects.get(water.id)!;
    const side = water.side;
    const along = side === "north" || side === "south" ? r.w : r.h;
    const length = clamp(Math.round(beam * 3 + 4), 5, Math.max(5, Math.min(along - 2, W + 1)));
    const off = behind(side) ? shadow + 1 : 1;
    const total = beam + 2;
    // Moored along the bank, nearer one end than the other.
    const centre = side === "north" || side === "south" ? building.x + Math.floor(W * (0.35 + 0.3 * rand())) : building.y + Math.floor(D * (0.35 + 0.3 * rand()));
    const start = clamp(centre - Math.floor(length / 2), (side === "north" || side === "south" ? r.x : r.y) + 1, (side === "north" || side === "south" ? r.x + r.w : r.y + r.h) - length - 1);
    const hull: Rect = side === "north" ? { x: start, y: r.y + r.h - off - total, w: length, h: total }
      : side === "south" ? { x: start, y: r.y + off, w: length, h: total }
      : side === "west" ? { x: r.x + r.w - off - total, y: start, w: total, h: length }
      : { x: r.x + off, y: start, w: total, h: length };
    for (let y = hull.y; y < hull.y + hull.h; y++) for (let x = hull.x; x < hull.x + hull.w; x++) {
      const edge = y === hull.y || x === hull.x || y === hull.y + hull.h - 1 || x === hull.x + hull.w - 1;
      set({ x, y }, edge ? tile("fence", { style: "hull", height: 1 }) : tile("boards"), edge ? undefined : boat.id);
    }
    // The gangplank: from the rail's middle on the bank side, across the water to the bank.
    const toBank = OPPOSITE[side];
    const mid = side === "north" || side === "south" ? { x: hull.x + Math.floor(hull.w / 2), y: side === "north" ? hull.y + hull.h - 1 : hull.y } : { x: side === "west" ? hull.x + hull.w - 1 : hull.x, y: hull.y + Math.floor(hull.h / 2) };
    for (let p = mid, i = 0; i < 12; p = add(p, DIR[toBank]), i++) {
      if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) break;
      const t = tiles[p.y]![p.x]!;
      if (i > 0 && t.terrain !== "water" && t.terrain !== "deep-water") break;
      set(p, tile("bridge"), i === 0 ? boat.id : water.id);
    }
    stripRects.set(boat.id, { x: hull.x + 1, y: hull.y + 1, w: hull.w - 2, h: hull.h - 2 });
  }

  // The building: outer walls, then the rooms carved out of its inside.
  const inner: Rect = { x: building.x + 1, y: building.y + 1, w: W - 2, h: D - 2 };
  const outerAt = (p: Tile2) => inBuilding(p) && [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].some(([dx, dy]) => !inBuilding({ x: p.x + dx!, y: p.y + dy! }));
  const main = plan.rooms.find(r => r.where === "main")!;
  const grid = new Map<string, string>(); // tile -> room id, or "#" for wall
  for (let y = building.y; y < building.y + D; y++) for (let x = building.x; x < building.x + W; x++) {
    const p = { x, y };
    if (!inBuilding(p)) continue;
    grid.set(tkey(p), outerAt(p) ? "#" : main.id);
  }
  const notchWalls = notch ? [{ x: notch.x - 1, y: notch.y - 1, w: notch.w + 2, h: notch.h + 2 }] : [];
  const annexes = carveRooms(plan.rooms.filter(r => r !== main), inner, notchWalls, rand, problems);
  for (const { room, rect } of annexes) {
    for (let y = rect.y - 1; y <= rect.y + rect.h; y++) for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      const k = tkey({ x, y });
      if (!grid.has(k)) continue;
      const inside = x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
      grid.set(k, inside ? room.id : "#");
    }
  }
  // The main room is what's left; if the annexes cut it in two, the smaller part is filled in.
  const mainTiles = [...grid].filter(([, v]) => v === main.id).map(([k]) => parse(k));
  const parts = components(mainTiles);
  if (parts.length > 1) {
    parts.sort((a, b) => b.length - a.length);
    for (const part of parts.slice(1)) for (const p of part) grid.set(tkey(p), "#");
    notes.push(`The rooms on the sides cut ${main.name} in two: the smaller part (${parts.slice(1).reduce((n, p) => n + p.length, 0)} squares) was walled up.`);
  }
  const roomTile = (r: RoomPlan) => floorTile(r.floor === "same" ? plan.floor : r.floor, style, wallHeight);
  const roomById = new Map(plan.rooms.map(r => [r.id, r]));
  for (const [k, v] of grid) {
    const p = parse(k);
    if (v === "#") set(p, outerAt(p) ? tile("wall", { style: walls, height: wallHeight }) : tile("wall", { style: partition, height: PARTITION }));
    else set(p, roomTile(roomById.get(v)!), v);
  }

  // The outside is joined up: an area cut off from the way in (the quay at the back of a burrow, the
  // landing at the front, the bank between) gets a way round the building, cut through what's in
  // the way: steps or a path through a bank, planks over water, never through a neighbour's house.
  for (const o of plan.outside) {
    if (o.ground === "water" || o.ground === "boat" || o.id === entranceArea.id) continue;
    joinUp(o);
  }
  function joinUp(o: OutsidePlan): void {
    const standable = (p: Tile2) => { const t = tiles[p.y]?.[p.x]; return !!t && walkable(t) && t.terrain !== "water" && t.terrain !== "deep-water" && !inRect(p, building); };
    const from: Tile2[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (area[y * width + x] === entranceArea.id && standable({ x, y })) from.push({ x, y });
    const seen = new Set(from.map(tkey));
    for (const queue = [...from]; queue.length;) {
      const p = queue.pop()!;
      for (const s of SIDES) { const n = add(p, DIR[s]); if (!seen.has(tkey(n)) && standable(n)) { seen.add(tkey(n)); queue.push(n); } }
    }
    const mine: Tile2[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (area[y * width + x] === o.id) mine.push({ x, y });
    if (!mine.length || mine.some(p => seen.has(tkey(p)))) return;
    // The cheapest way from it to anywhere joined: open ground costs a step, a bank three, water four.
    const cost = (p: Tile2) => {
      if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height || inRect(p, building)) return Infinity;
      const t = tiles[p.y]![p.x]!;
      if (standable(p)) return 1;
      if (t.terrain === "fence") return Infinity;
      if (t.terrain === "wall" && t.style === "bank") return 3;
      if (t.terrain === "water" || t.terrain === "deep-water") return 4;
      if (t.terrain === "void") return 3;
      return Infinity;
    };
    const dist = new Map<string, number>(mine.map(p => [tkey(p), 0]));
    const prev = new Map<string, string>();
    const open = mine.map(p => ({ p, d: 0 }));
    let end: Tile2 | undefined;
    while (open.length) {
      open.sort((a, b) => a.d - b.d);
      const { p, d } = open.shift()!;
      if (d > (dist.get(tkey(p)) ?? Infinity)) continue;
      if (seen.has(tkey(p))) { end = p; break; }
      for (const s of SIDES) {
        const n = add(p, DIR[s]);
        const c = cost(n);
        if (c === Infinity) continue;
        const nd = d + c;
        if (nd < (dist.get(tkey(n)) ?? Infinity)) { dist.set(tkey(n), nd); prev.set(tkey(n), tkey(p)); open.push({ p: n, d: nd }); }
      }
    }
    if (!end) return;
    const path = entranceArea.ground === "steps" || o.ground === "steps" ? "steps" : o.ground === "planks-over-water" ? "boards" : o.ground;
    for (let k: string | undefined = tkey(end); k; k = prev.get(k)) {
      const p = parse(k);
      if (standable(p)) continue;
      const t = tiles[p.y]![p.x]!;
      set(p, t.terrain === "water" || t.terrain === "deep-water" ? tile("bridge") : groundTile(path, 0), o.id);
    }
    notes.push(`${o.name} was cut off from the way in: a way round the building joins them.`);
  }

  // Areas: rooms and outside, with their tiles.
  const tilesIn = (id: string) => { const out: Tile2[] = []; for (let i = 0; i < area.length; i++) if (area[i] === id) out.push({ x: i % width, y: Math.floor(i / width) }); return out; };
  for (const r of plan.rooms) {
    const ts = tilesIn(r.id);
    if (!ts.length) { problems.push({ check: "fit", subject: r.id, message: `There was no room for ${r.name} on the ${dir(r.where)} side of the building: make it smaller, or put it on another side.`, severity: "error" }); continue; }
    areas.set(r.id, { id: r.id, name: r.name, description: r.description, room: true, tiles: ts, bbox: bbox(ts), rect: bbox(ts), ground: r.floor === "same" ? plan.floor : r.floor });
  }
  for (const o of plan.outside) {
    const ts = tilesIn(o.id);
    if (!ts.length) continue;
    areas.set(o.id, { id: o.id, name: o.name, description: o.description, room: false, tiles: ts, bbox: bbox(ts), rect: stripRects.get(o.id) ?? bbox(ts), side: o.side, ground: o.ground, ...(o.ground === "boat" ? { boat: true } : {}) });
  }

  // Doors.
  const doors: DoorInfo[] = [];
  const isDoorNear = (p: Tile2) => doors.some(d => Math.abs(d.at.x - p.x) + Math.abs(d.at.y - p.y) <= 1);
  const outsideOf = (id: string) => plan.outside.find(o => o.id === id);
  const roomAt = (p: Tile2) => grid.get(tkey(p));
  for (const d of plan.doors) {
    const placed = placeDoor(d, d.from, d.to);
    if (placed) doors.push(placed);
  }
  function placeDoor(d: DoorPlan, from: string, to: string, quiet = false): DoorInfo | undefined {
    const o = outsideOf(to);
    const candidates: Array<{ at: Tile2; inside: Tile2; outside: Tile2; side: Side }> = [];
    if (o) {
      // Through the outside wall on the outside area's side (a boat: its water's side).
      const side = o.ground === "boat" ? boatBerths.find(b => b.boat.id === o.id)?.water.side ?? o.side : o.side;
      for (const at of wallRun(building, side)) {
        const inside = add(at, DIR[OPPOSITE[side]]), out = add(at, DIR[side]);
        if (roomAt(inside) !== from || isDoorNear(at)) continue;
        const along = side === "north" || side === "south" ? [add(at, DIR.east), add(at, DIR.west)] : [add(at, DIR.north), add(at, DIR.south)];
        if (along.some(p => roomAt(p) !== "#")) continue;
        candidates.push({ at, inside, outside: out, side });
      }
      if (!candidates.length) {
        if (!quiet) problems.push({ check: "door", subject: d.id, message: `${d.name} can't open from ${roomById.get(from)?.name ?? from} onto ${o.name}: ${roomById.get(from)?.name ?? from} doesn't touch the building's ${dir(side)} wall, where ${o.name} is. Move the room to that side, or the door to a room that's there.`, severity: "error" });
        return undefined;
      }
    } else {
      for (const [k, v] of grid) {
        if (v !== "#") continue;
        const at = parse(k);
        if (outerAt(at) || isDoorNear(at)) continue;
        for (const side of SIDES) {
          const inside = add(at, DIR[OPPOSITE[side]]), out = add(at, DIR[side]);
          if (roomAt(inside) !== from || roomAt(out) !== to) continue;
          const along = side === "north" || side === "south" ? [add(at, DIR.east), add(at, DIR.west)] : [add(at, DIR.north), add(at, DIR.south)];
          if (along.some(p => roomAt(p) !== "#")) continue;
          candidates.push({ at, inside, outside: out, side });
        }
      }
      if (!candidates.length) {
        if (!quiet) problems.push({ check: "door", subject: d.id, message: `${d.name} can't join ${roomById.get(from)?.name ?? from} and ${roomById.get(to)?.name ?? to}: they don't share a wall. Put them side by side, or join each to the main room instead.`, severity: "error" });
        return undefined;
      }
    }
    // The wall the plan asked for; along it, somewhere the seed says (the middle, or off to one
    // side: a door bang in the middle of every wall looks drawn by a committee).
    const wanted = d.wall !== "any" ? candidates.filter(c => c.side === d.wall) : [];
    if (d.wall !== "any" && !wanted.length && !quiet) problems.push({ check: "relation", subject: d.id, message: `${d.name} was asked for on the ${dir(d.wall)} wall of ${roomById.get(from)?.name ?? from}, but what it joins isn't on that side: it went on the ${dir(candidates[0]!.side)} wall.`, severity: "warning" });
    const pool = wanted.length ? wanted : candidates;
    // The longest wall they share (a corner room touches the main room on two).
    const side = [...new Set(pool.map(c => c.side))].sort((a, b) => pool.filter(c => c.side === b).length - pool.filter(c => c.side === a).length)[0]!;
    const run = pool.filter(c => c.side === side).sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y);
    const share = [0.5, 0.3, 0.7, 0.4, 0.6][Math.floor(rand() * 5)]!;
    const best = run[clamp(Math.round((run.length - 1) * share), 0, run.length - 1)]!;
    const locked = d.states.some(s => s === "locked" || s === "barred" || s === "bolted");
    const outer = outerAt(best.at);
    // A door is of what its wall is (a burrow's is timber, as the Rat's is).
    set(best.at, tile("door", { style: outer ? walls : partition, height: outer ? wallHeight : PARTITION, ...(locked ? { blocks: true } : {}) }));
    grid.set(tkey(best.at), `door:${d.id}`);
    return { id: d.id, plan: d, at: best.at, inside: best.inside, outside: best.outside, from, to, side: best.side };
  }

  // Every room needs a way in: a door to a room it shares a wall with (the main room first).
  const connected = () => {
    const seen = new Set<string>();
    const entry = doors.filter(d => outsideOf(d.to));
    const queue = entry.map(d => d.from);
    for (const id of queue) seen.add(id);
    while (queue.length) {
      const id = queue.shift()!;
      for (const d of doors) {
        const other = d.from === id ? d.to : d.to === id ? d.from : undefined;
        if (other && !seen.has(other) && roomById.has(other)) { seen.add(other); queue.push(other); }
      }
    }
    return seen;
  };
  if (!doors.some(d => outsideOf(d.to))) {
    const street = entranceArea;
    const touching = [main, ...plan.rooms.filter(r => r !== main)];
    let added: DoorInfo | undefined;
    for (const r of touching) {
      added = placeDoor({ id: `${r.id}-street-door`, name: "the street door", description: "", from: r.id, to: street.id, wall: street.side, states: ["closed"] }, r.id, street.id, true);
      if (added) break;
    }
    if (added) {
      doors.push(added);
      problems.push({ check: "door", subject: added.id, message: `No door opens onto the outside: one was added from ${roomById.get(added.from)?.name} onto ${street.name}.`, severity: "warning" });
    }
  }
  for (let guard = 0; guard < plan.rooms.length; guard++) {
    const seen = connected();
    const stranded = plan.rooms.filter(r => !seen.has(r.id) && areas.has(r.id));
    if (!stranded.length) break;
    let fixed = false;
    for (const r of stranded) {
      for (const other of [main, ...plan.rooms].filter(o => o !== r && seen.has(o.id))) {
        const d = placeDoor({ id: `${r.id}-door`, name: `the door to ${r.name.replace(/^the /i, "")}`, description: "", from: other.id, to: r.id, wall: "any", states: ["closed"] }, other.id, r.id, true);
        if (d) { doors.push(d); notes.push(`${r.name} had no way in: a door was added from ${other.name}.`); fixed = true; break; }
      }
      if (fixed) break;
    }
    if (!fixed) break;
  }
  // The way in: the door to outside by the player's start, else the street door, else any door out.
  const out = doors.filter(d => outsideOf(d.to));
  const entrance = out.find(d => d.to === plan.start) ?? out.find(d => d.from === plan.start && d.to === entranceArea.id) ?? out.find(d => d.from === plan.start)
    ?? out.find(d => d.to === entranceArea.id) ?? out[0];

  // Windows: spaced along the room's stretch of outside wall, clear of doors and corners.
  const windows: Site["windows"] = [];
  for (const w of plan.windows) {
    // Looking out on something: not into a bank or a neighbour's wall (a fire would shine through it onto the turf).
    const outlook = (at: Tile2) => { const t = tiles[add(at, DIR[w.wall]).y]?.[add(at, DIR[w.wall]).x]; return !!t && t.terrain !== "wall" && t.terrain !== "void"; };
    const run = wallRun(building, w.wall).filter(at => grid.get(tkey(at)) === "#" && outlook(at) && roomAt(add(at, DIR[OPPOSITE[w.wall]])) === w.room && !isDoorNear(at) && !windows.some(x => x.at.x === at.x && x.at.y === at.y));
    if (!run.length) { problems.push({ check: "relation", subject: w.room, message: `${roomById.get(w.room)?.name ?? w.room} has no ${dir(w.wall)} outside wall for its windows: they were left out.`, severity: "warning" }); continue; }
    const count = Math.min(w.count, Math.ceil(run.length / 2));
    for (let i = 0; i < count; i++) {
      const at = run[Math.min(run.length - 1, Math.floor(((i + 0.5) * run.length) / count))]!;
      if (windows.some(x => Math.abs(x.at.x - at.x) + Math.abs(x.at.y - at.y) <= 1)) continue;
      set(at, tile("window", { style: walls, height: wallHeight }));
      windows.push({ at, room: w.room, side: w.wall });
    }
  }

  // Where you walk off the map: the street's squares on the map's edge, else its ends.
  const exits: Tile2[] = [];
  const street = stripRects.get(entranceArea.id);
  if (street) {
    for (let y = street.y; y < street.y + street.h; y++) for (let x = street.x; x < street.x + street.w; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (edge && walkable(tiles[y]![x]!) && area[y * width + x] === entranceArea.id) exits.push({ x, y });
    }
    if (!exits.length) {
      const across = entranceArea.side === "north" || entranceArea.side === "south";
      for (let i = 0; i < (across ? street.h : street.w); i++) for (const end of [0, 1]) {
        const p = across ? { x: end ? street.x + street.w - 1 : street.x, y: street.y + i } : { x: street.x + i, y: end ? street.y + street.h - 1 : street.y };
        if (walkable(tiles[p.y]![p.x]!) && area[p.y * width + p.x] === entranceArea.id) exits.push(p);
      }
    }
  }
  return { width, height, tiles, area, areas, doors, windows, building, ...(notch ? { notch } : {}), style, wallHeight, exits, ...(entrance ? { entrance } : {}), problems, notes };
}

/** The tiles of the building's outside wall on one side, corners left out (some may be the notch's: check). */
function wallRun(b: Rect, side: Side): Tile2[] {
  const out: Tile2[] = [];
  if (side === "north" || side === "south") for (let x = b.x + 1; x < b.x + b.w - 1; x++) out.push({ x, y: side === "north" ? b.y : b.y + b.h - 1 });
  else for (let y = b.y + 1; y < b.y + b.h - 1; y++) out.push({ x: side === "west" ? b.x : b.x + b.w - 1, y });
  return out;
}

/**
 * The rooms that aren't the main one, as rectangles inside the building: corners first, then
 * sides, biggest first, each kept a wall's width from the others (and from a left-out corner). A
 * room that won't fit shrinks.
 */
function carveRooms(rooms: RoomPlan[], inner: Rect, blocked: Rect[], rand: () => number, problems: Problem[]): Array<{ room: RoomPlan; rect: Rect }> {
  const placed: Array<{ room: RoomPlan; rect: Rect }> = [];
  const isCorner = (w: string) => w.includes("-");
  const order = [...rooms].sort((a, b) => Number(isCorner(b.where)) - Number(isCorner(a.where)) || b.width * b.depth - a.width * a.depth);
  const clear = (r: Rect) => placed.every(p => !overlaps(r, grow(p.rect, 1))) && blocked.every(b => !overlaps(r, grow(b, 1)));
  // Leave the main room its squares beside every room. Into the building, a room may take what
  // leaves the main room five squares (and a wall); along a side, all of it.
  const maxW = (w: string) => (w === "north" || w === "south" ? inner.w : inner.w - MAIN_MIN - 1);
  const maxH = (w: string) => (w === "east" || w === "west" ? inner.h : inner.h - MAIN_MIN - 1);
  for (const room of order) {
    const least = (most: number) => Math.min(MIN_ROOM, Math.max(2, most));
    let w = clamp(tilesOf(room.width), least(maxW(room.where)), Math.max(2, maxW(room.where)));
    let h = clamp(tilesOf(room.depth), least(maxH(room.where)), Math.max(2, maxH(room.where)));
    let rect: Rect | undefined;
    const flip = rand() < 0.5;
    for (let tries = 0; !rect && tries < 24; tries++) {
      rect = positions(room.where as Side | Corner, w, h, inner, flip).map(r => snap(r, room.where, inner, [...placed.map(p => p.rect), ...blocked])).find(clear);
      if (rect) break;
      // Shrink along the side first (rooms on one side pack along it), then into the building.
      const along = room.where === "north" || room.where === "south" ? "w" : room.where === "east" || room.where === "west" ? "h" : w >= h ? "w" : "h";
      if (along === "w" && w > 2) w--; else if (along === "h" && h > 2) h--; else if (w > 2) w--; else if (h > 2) h--; else break;
    }
    if (!rect) {
      problems.push({ check: "fit", subject: room.id, message: `${room.name} doesn't fit on the ${dir(room.where)} side of the building beside the other rooms there: put it on another side, or make the building bigger.`, severity: "error" });
      continue;
    }
    if (rect.w * 5 < room.width - 7 || rect.h * 5 < room.depth - 7) problems.push({ check: "fit", subject: room.id, message: `${room.name} was made ${rect.w * 5} by ${rect.h * 5} ft to fit (it asked for ${Math.round(room.width)} by ${Math.round(room.depth)}).`, severity: "warning" });
    placed.push({ room, rect });
  }
  return placed;
}

/**
 * A room on a side, stretched along it to close a gap of a square at either end (to the building's
 * corner, or to the next room's wall): a gap that small would be a useless alcove of the main room,
 * or a doubled wall.
 */
function snap(r: Rect, where: string, inner: Rect, others: Rect[]): Rect {
  const horizontal = where === "north" || where === "south";
  if (!horizontal && where !== "east" && where !== "west") return r;
  const across = (o: Rect) => (horizontal ? o.y < r.y + r.h && r.y < o.y + o.h : o.x < r.x + r.w && r.x < o.x + o.w);
  const lo = horizontal ? inner.x : inner.y, hi = horizontal ? inner.x + inner.w - 1 : inner.y + inner.h - 1;
  let a = horizontal ? r.x : r.y, b = horizontal ? r.x + r.w - 1 : r.y + r.h - 1;
  // The nearest thing before and after the room along the side: the building's corner or a room.
  let before = lo, after = hi;
  for (const o of others) {
    if (!across(o)) continue;
    const oa = horizontal ? o.x : o.y, ob = horizontal ? o.x + o.w - 1 : o.y + o.h - 1;
    if (ob < a) before = Math.max(before, ob + 2);
    if (oa > b) after = Math.min(after, oa - 2);
  }
  // A gap of one free square (or none: the room's wall doubling the building's) is closed.
  if (a - before >= 1 && a - before <= 2) a = before;
  if (after - b >= 1 && after - b <= 2) b = after;
  return horizontal ? { ...r, x: a, w: b - a + 1 } : { ...r, y: a, h: b - a + 1 };
}

/**
 * Where a room of w by h can sit on a side or in a corner, best first. Along a side, tucked into one
 * of its corners (the seed says which), then the other, then the middle outwards: a room in a corner
 * leaves the main room an L; one in the middle of a side leaves it a U, with two narrow arms.
 */
function positions(where: Side | Corner, w: number, h: number, inner: Rect, flip: boolean): Rect[] {
  const right = inner.x + inner.w - w, bottom = inner.y + inner.h - h;
  switch (where) {
    case "north-west": return [{ x: inner.x, y: inner.y, w, h }];
    case "north-east": return [{ x: right, y: inner.y, w, h }];
    case "south-west": return [{ x: inner.x, y: bottom, w, h }];
    case "south-east": return [{ x: right, y: bottom, w, h }];
  }
  const out: Rect[] = [];
  if (where === "north" || where === "south") {
    const y = where === "north" ? inner.y : bottom;
    for (let x = inner.x; x <= right; x++) out.push({ x, y, w, h });
    const mid = inner.x + (inner.w - w) / 2;
    const key = (r: Rect) => (r.x === (flip ? inner.x : right) ? 0 : r.x === (flip ? right : inner.x) ? 1 : 2 + Math.abs(r.x - mid));
    return out.sort((a, b) => key(a) - key(b) || a.x - b.x);
  }
  const x = where === "west" ? inner.x : right;
  for (let y = inner.y; y <= bottom; y++) out.push({ x, y, w, h });
  const mid = inner.y + (inner.h - h) / 2;
  const key = (r: Rect) => (r.y === (flip ? bottom : inner.y) ? 0 : r.y === (flip ? inner.y : bottom) ? 1 : 2 + Math.abs(r.y - mid));
  return out.sort((a, b) => key(a) - key(b) || a.y - b.y);
}

const grow = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const parse = (k: string): Tile2 => { const [x, y] = k.split(",").map(Number) as [number, number]; return { x, y }; };

export function bbox(ts: Tile2[]): Rect {
  const xs = ts.map(p => p.x), ys = ts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

/** 4-connected groups of tiles. */
export function components(ts: Tile2[]): Tile2[][] {
  const left = new Set(ts.map(tkey));
  const out: Tile2[][] = [];
  for (const start of ts) {
    if (!left.has(tkey(start))) continue;
    const part: Tile2[] = [];
    const queue = [start];
    left.delete(tkey(start));
    while (queue.length) {
      const p = queue.pop()!;
      part.push(p);
      for (const s of SIDES) { const n = add(p, DIR[s]); if (left.has(tkey(n))) { left.delete(tkey(n)); queue.push(n); } }
    }
    out.push(part);
  }
  return out;
}
