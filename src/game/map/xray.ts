import type { SceneWorld } from "../../world/scene-world.ts";
import type { MapActor, Span, StyledLine, Tile2, TileMap } from "../types.ts";
import { exploreFrame, type ExploreState } from "./explore.ts";
import { raiseFor } from "./looks.ts";
import { hex, mix, rgb } from "./palette.ts";
import { Picks, render, screenOf, type RenderOptions, type Viewport } from "./render.ts";
import { inBounds, isRoofed, isStructure, tileAt, type MapTile } from "./tiles.ts";

/**
 * X-ray: seeing who's behind a building. The renderer paints back to front, so a roof, a wall or a
 * tree nearer the viewer (or a stack of sacks, if it's ever drawn tall) covers whoever stands just
 * behind it, up the screen; today only the player is drawn through, on purple, and everyone else
 * vanishes. renderXray wraps render(): it draws the frame as usual and looks for who matters (the
 * player, people, creatures, items, things a scene put there) under something nearer. If anyone
 * is, it draws the frame again with those buildings cleared away round them, and blends the two in
 * a soft patch round each hidden one: what's behind shows through, tinted with the building's
 * colours and shading, the building's outline kept so its shape still reads, fading back to solid
 * with distance. The hidden are drawn a little greyer; you keep your own mark, so you're found at a
 * glance. A frame with nobody hidden costs one render and a few tile lookups, and comes back
 * untouched; one with someone hidden costs two renders and a pass over the patches.
 *
 * In views.ts, once the look wiring lands: townView returns xrayExplore(ex, size, {...}) where it
 * returns renderExplore(ex, size, {...}), and fightView renderXray(G.map, actors, centre, size, {...})
 * where it returns render(...); if the look draws with its own renderer, pass it as { draw }.
 */

/** How a patch looks. */
export interface XrayStyle {
  /** A person's patch: half-width and half-height in cells (a cell is about twice as tall as wide). */
  rx: number;
  ry: number;
  /** A thing's patch, as a share of a person's (a clue needs a peephole, not a window). */
  things: number;
  /** How solid the building is at the hidden one's cell (0 clear, 1 solid); it's solid at the patch's edge. */
  clear: number;
  /** The share of the patch, from the middle, that stays that clear before it fades. */
  core: number;
  /** The building's outline is at least this solid. */
  outline: number;
  /** A jump in shade between neighbouring cells (0..1) that counts as an edge to keep (where a face turns). */
  turn: number;
  /** How much greyer what's seen through the building is (0..1). */
  grey: number;
}

/** The explore view's frame, as renderExplore draws it (explore.ts): x-ray draws the same one. */
export { exploreFrame };

export const XRAY_STYLE: XrayStyle = { rx: 10, ry: 4.5, things: 0.6, clear: 0.25, core: 0.35, outline: 0.8, turn: 0.16, grey: 0.35 };

/** A renderer with render()'s shape (the look layer's, once it has one). */
export type Draw = (map: TileMap, actors: MapActor[], camera: Tile2, viewport: Viewport, options?: RenderOptions) => StyledLine[];

export interface XrayHow { draw?: Draw; style?: XrayStyle }

export interface Hidden {
  actor: MapActor;
  /** Where it's drawn on screen (its cell). */
  cell: { x: number; y: number };
}

export interface XrayFrame {
  lines: StyledLine[];
  /** Who and what that matters is behind something (empty: the frame is the renderer's, untouched). */
  hidden: Hidden[];
}

/** render(), with whoever matters behind a building shown through it. */
export function renderXray(map: TileMap, actors: MapActor[], camera: Tile2, viewport: Viewport, options: RenderOptions = {}, how: XrayHow = {}): StyledLine[] {
  return xray(map, actors, camera, viewport, options, how).lines;
}

/** The town round the player (or a scene's place), as renderExplore draws it, x-rayed. */
export function xrayExplore(state: ExploreState, viewport: Viewport, options: RenderOptions & { world?: SceneWorld } = {}, how: XrayHow = {}): StyledLine[] {
  const f = exploreFrame(state, viewport, options);
  return renderXray(f.map, f.actors, f.camera, viewport, f.options, how);
}

/** The frame, x-rayed, and who's hidden in it. */
export function xray(map: TileMap, actors: MapActor[], camera: Tile2, viewport: Viewport, options: RenderOptions = {}, how: XrayHow = {}): XrayFrame {
  const draw = how.draw ?? render, style = how.style ?? XRAY_STYLE;
  const front = draw(map, actors, camera, viewport, options);
  // For the mouse: the frame without the buildings says what's drawn where behind them, in picks of
  // its own; a cell takes them where what's behind shows through (a click on Kell seen through the
  // warehouse is on Kell), and keeps the building's where the building shows.
  const behindPicks = options.pick ? new Picks() : undefined;
  const found = findHidden(front, map, actors, camera, viewport, behindPicks ? { ...options, pick: behindPicks } : options, how);
  if (!found.hidden.length || !found.behind) return { lines: front, hidden: [] };
  // Everyone drawn in the patches comes through as themselves (a door is drawn as its tile).
  const figures = actors.filter(a => a.map === map.id && !(a.kind === "object" && tileAt(map, a.at).terrain === "door")).map(a => cellOf(map, a, camera, viewport));
  const through = new Set<number>();
  const lines = composite(front, found.behind, found.hidden, figures, viewport, options.color !== false, style, through);
  if (options.pick && behindPicks) options.pick.take(behindPicks, through);
  return { lines, hidden: found.hidden };
}

// ---------------------------------------------------------------------------------------------
// Who's hidden.

/**
 * Worth seeing through a wall for: you, people and creatures, items, and things a scene put there or
 * that lead somewhere. Not the town's dressing (lamp posts, stalls, notices), nor bunting overhead.
 */
export function matters(a: MapActor, player?: Tile2): boolean {
  const states = a.states ?? [];
  if (states.includes("gone") || states.includes("overhead")) return false;
  if (a.kind === "player" || a.kind === "person" || a.kind === "creature") return true;
  // Things only close by: a clue behind the water butt isn't spotlighted from the lane.
  const near = !player || Math.max(Math.abs(a.at.x - player.x), Math.abs(a.at.y - player.y)) <= 3;
  return near && (a.kind === "item" || !!a.ref || a.interaction?.kind === "scene" || a.interaction?.kind === "travel");
}

/**
 * Who's covered in a rendered frame, and the frame drawn without what covers them. A tile hides the
 * cell of whoever stands m tiles behind it (north-east of it, up the screen) when it's drawn at
 * least 2m rows tall, more if they're raised: that finds the candidates in a few lookups each. The
 * second render, with the buildings round them cleared, says which really were hidden: the renderer
 * stays the judge of what's drawn where.
 */
export function findHidden(front: StyledLine[], map: TileMap, actors: MapActor[], camera: Tile2, viewport: Viewport, options: RenderOptions = {}, how: XrayHow = {}): { hidden: Hidden[]; behind?: StyledLine[] } {
  const draw = how.draw ?? render, style = how.style ?? XRAY_STYLE;
  const here = actors.filter(a => a.map === map.id);
  // A door is drawn as its door tile's state, not as itself.
  const isDoor = (a: MapActor) => a.kind === "object" && tileAt(map, a.at).terrain === "door";
  let rooms: Rooms | undefined;
  const candidates: Hidden[] = [];
  const player = here.find(a => a.kind === "player")?.at;
  for (const a of here) {
    if (!matters(a, player) || isDoor(a)) continue;
    const cell = cellOf(map, a, camera, viewport);
    if (cell.x < 0 || cell.y < 0 || cell.x >= viewport.w || cell.y >= viewport.h) continue;
    if (!coverable(map, a.at, cell.raised, options)) continue;
    // Drawn as itself: not hidden. (You're always drawn, through a wall if need be: the second render tells.)
    if (a.kind !== "player" && cellAt(front, cell)?.ch === a.glyph) continue;
    // Inside a building with its roof on isn't behind it: nobody in there is drawn.
    rooms ??= openRooms(map, camera, options);
    if (a.kind !== "player" && isRoofed(tileAt(map, a.at)) && options.roofs !== false && !rooms.tiles.has(key(a.at))) continue;
    candidates.push({ actor: a, cell: { x: cell.x, y: cell.y } });
  }
  if (!candidates.length) return { hidden: [] };
  rooms ??= openRooms(map, camera, options);
  // What someone stands on (a wall top, a floor under a roof) or the lead marker sits on keeps its shape.
  const occupied = new Set(here.filter(a => !isDoor(a)).map(a => key(a.at)));
  if (options.lead) occupied.add(key(options.lead));
  const ctx: Clearing = { rooms, occupied, doors: new Set(here.filter(isDoor).map(a => key(a.at))), lit: options.time === "evening" || options.time === "night" };
  const cleared = new Map<string, MapTile>();
  for (const c of candidates) clearInFront(map, c.actor.at, c.cell, reach(c.actor, style), camera, viewport, options, ctx, cleared);
  if (!cleared.size) return { hidden: [] };
  const behind = draw(withTiles(map, cleared), actors, camera, viewport, options);
  // Shown in the second render where the first had something else on top. You're drawn either way:
  // it's how you're drawn that tells (picked out through the wall, or plain).
  const hidden = candidates.filter(c => {
    const a = cellAt(front, c.cell), b = cellAt(behind, c.cell);
    return c.actor.kind === "player" ? !sameCell(a, b) : !!a && !!b && a.ch !== b.ch;
  });
  return { hidden, behind };
}

/** Where a figure is drawn: its tile's cell, raised if it hangs or sits up high, or stands on a wall top. */
function cellOf(map: TileMap, a: MapActor, camera: Tile2, viewport: Viewport): { x: number; y: number; raised: number } {
  const t = tileAt(map, a.at);
  const raised = (isStructure(t) && t.blocks ? Math.max(0, t.height ?? 0) : 0) + raiseFor(a.name, a.states ?? []);
  const s = screenOf(a.at, camera, viewport);
  return { x: s.x, y: s.y - raised, raised };
}

/** The half-width and half-height of a hidden one's patch, in cells. */
function reach(a: MapActor, style: XrayStyle): { rx: number; ry: number } {
  const k = a.kind === "object" || a.kind === "item" ? style.things : 1;
  return { rx: style.rx * k, ry: style.ry * k };
}

/** How many rows a tile's middle column reaches above its own row when drawn (0 for ground). */
function drawnHeight(t: MapTile, options: RenderOptions): number {
  if (t.terrain === "tree") return 2;
  if (isStructure(t)) return t.terrain === "door" && (t.height ?? 1) <= 1 ? 0 : clampHeight(t.height ?? 1);
  if (isRoofed(t)) return options.roofs === false ? 0 : clampHeight(t.roofHeight ?? 3);
  // A stack of sacks on a battlefield: as tall as it says, should the renderer draw it so.
  if (t.blocks && (t.height ?? 0) >= 2) return clampHeight(t.height!);
  return 0;
}

const clampHeight = (h: number) => Math.max(1, Math.min(6, h));

/** Could anything in front of this tile reach up over a figure raised so many rows on it? */
function coverable(map: TileMap, at: Tile2, raised: number, options: RenderOptions): boolean {
  for (let m = 1; m <= 3; m++) if (drawnHeight(tileAt(map, { x: at.x - m, y: at.y + m }), options) >= 2 * m + raised) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Clearing the way: the map for the second render.

interface Clearing { rooms: Rooms; occupied: Set<string>; doors: Set<string>; lit: boolean }

/**
 * Clear away the buildings (walls, roofs, trees) that stand at or nearer than a figure's depth
 * somewhere in its patch: all of each that's drawn into the patch, so what's left doesn't show a cut
 * face. A building wholly behind the figure stays.
 */
function clearInFront(map: TileMap, at: Tile2, cell: { x: number; y: number }, patch: { rx: number; ry: number }, camera: Tile2, viewport: Viewport, options: RenderOptions, ctx: Clearing, out: Map<string, MapTile>): void {
  const S = at.x + at.y, R = at.y - at.x;
  const base = screenOf(at, camera, viewport);
  const span = Math.ceil((patch.rx + 2) / 2), ry = Math.ceil(patch.ry);
  const groups = buildings(map);
  const inPatch: Array<{ p: Tile2; t: MapTile; group: number }> = [];
  const nearer = new Set<number>();
  for (let r = R - ry - 10; r <= R + ry + 8; r++) for (let s = S - span; s <= S + span; s++) {
    if (((s - r) % 2 + 2) % 2 || (r === R && s === S)) continue;
    const p = { x: (s - r) / 2, y: (s + r) / 2 };
    if (!inBounds(map, p)) continue;
    const t = tileAt(map, p);
    const h = drawnHeight(t, options);
    if (!h) continue;
    // The tile's drawing: three columns, from h rows above its row to the cell below it.
    const sc = base.x + 2 * (s - S), sr = base.y + (r - R);
    const dx = Math.max(0, Math.abs(sc - cell.x) - 1), dy = Math.max(0, sr - h - cell.y, cell.y - (sr + 1));
    if ((dx / patch.rx) ** 2 + (dy / patch.ry) ** 2 >= 1) continue;
    const group = groups[p.y * map.width + p.x]!;
    inPatch.push({ p, t, group });
    if (r >= R) nearer.add(group);
  }
  for (const { p, t, group } of inPatch) {
    const k = key(p);
    if (!nearer.has(group) || out.has(k)) continue;
    const swap = cleared(p, t, ctx);
    if (swap) out.set(k, swap);
  }
}

/**
 * A tile with its building cleared: the ground under it, as the renderer draws a wall's or a
 * roof's. Some only come down to a ledge, so that the second render doesn't change anywhere else:
 * walls round an open yard (the cutaway's flood would run out into the street), a roof with someone
 * under it (they'd be on show), a door with its door on it, a lit window after dark (its light would
 * go out); a wall someone stands on stays put, and so do the open rooms (they're drawn open already).
 */
function cleared(p: Tile2, t: MapTile, ctx: Clearing): MapTile | undefined {
  const k = key(p);
  if (ctx.rooms.tiles.has(k)) return undefined;
  const byYard = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ctx.rooms.yards.has(key({ x: p.x + dx!, y: p.y + dy! })));
  if (t.terrain === "tree") return byYard ? undefined : { ...t, terrain: "floor" };
  if (isStructure(t)) {
    if (ctx.occupied.has(k) && t.blocks) return undefined;
    if (byYard || ctx.doors.has(k) || (ctx.lit && t.terrain === "window")) return (t.height ?? 1) > 1 ? { ...t, height: 1 } : undefined;
    const { roof: _roof, roofHeight: _roofHeight, height: _height, opaque: _opaque, ...ground } = t;
    return { ...ground, terrain: "floor" };
  }
  if (isRoofed(t)) {
    if (byYard || ctx.occupied.has(k)) return (t.roofHeight ?? 3) > 1 ? { ...t, roofHeight: 1 } : undefined;
    const { roof: _roof, roofHeight: _roofHeight, ...floor } = t;
    return floor;
  }
  return { ...t, height: 0 };
}

/** Built things by connected run of raised tiles (walls, roofs, trees, stacks): a number per tile, 0 for open ground. */
const BUILDINGS = new WeakMap<TileMap, Int32Array>();

function buildings(map: TileMap): Int32Array {
  const cached = BUILDINGS.get(map);
  if (cached) return cached;
  const out = new Int32Array(map.width * map.height);
  const raised = (t: MapTile) => isStructure(t) || isRoofed(t) || t.terrain === "tree" || (!!t.blocks && (t.height ?? 0) >= 2);
  let next = 0;
  for (let y0 = 0; y0 < map.height; y0++) for (let x0 = 0; x0 < map.width; x0++) {
    if (out[y0 * map.width + x0] || !raised(tileAt(map, { x: x0, y: y0 }))) continue;
    const id = ++next;
    out[y0 * map.width + x0] = id;
    const queue: Tile2[] = [{ x: x0, y: y0 }];
    while (queue.length) {
      const p = queue.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = { x: p.x + dx, y: p.y + dy };
        if (!inBounds(map, n) || out[n.y * map.width + n.x] || !raised(tileAt(map, n))) continue;
        out[n.y * map.width + n.x] = id;
        queue.push(n);
      }
    }
  }
  BUILDINGS.set(map, out);
  return out;
}

/**
 * The rooms render() opens: the focus's and any revealed (render.ts's opening(), its flood fill),
 * unless they reach the map's edge (outdoors). `yards` are the open ones without a roof.
 */
interface Rooms { tiles: Set<string>; yards: Set<string> }

function openRooms(map: TileMap, camera: Tile2, options: RenderOptions): Rooms {
  const tiles = new Set<string>(), yards = new Set<string>();
  if (options.cutaway === false) return { tiles, yards };
  const seen = new Set<string>();
  for (const start of [options.focus ?? camera, ...(options.reveal ?? [])]) {
    if (seen.has(key(start)) || !inBounds(map, start)) continue;
    const roofed = isRoofed(tileAt(map, start));
    const room = new Set([key(start)]);
    const queue = [start];
    let outdoors = false;
    while (queue.length && room.size < 900) {
      const p = queue.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = { x: p.x + dx, y: p.y + dy };
        if (!inBounds(map, n)) { outdoors = true; continue; }
        const t = tileAt(map, n);
        if (t.terrain === "void") { outdoors = true; continue; }
        if (isStructure(t) || t.terrain === "tree" || isRoofed(t) !== roofed) continue;
        const k = key(n);
        if (room.has(k)) continue;
        room.add(k); queue.push(n);
      }
    }
    for (const k of room) seen.add(k);
    if (outdoors || room.size >= 900) continue;
    for (const k of room) { tiles.add(k); if (!roofed) yards.add(k); }
  }
  return { tiles, yards };
}

/** A copy of the map with some tiles swapped (the rows that change are copied; the rest are shared). */
function withTiles(map: TileMap, tiles: Map<string, MapTile>): TileMap {
  const rows = [...map.tiles];
  const copied = new Set<number>();
  for (const [k, t] of tiles) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (!copied.has(y)) { rows[y] = [...rows[y]!]; copied.add(y); }
    rows[y]![x] = t;
  }
  return { ...map, tiles: rows };
}

// ---------------------------------------------------------------------------------------------
// Blending the two frames.

interface Cell { ch: string; fg: string; bg: string; bold: boolean }

/** The terminal's own background, for blending blank cells. */
const SCREEN = "#101014";

/**
 * In a soft patch round each hidden one, the cells where the frames differ (the building in the
 * way) show the frame without it, tinted towards the building's colour and shading; the building's
 * outline stays; the patch fades out into the frame as drawn. The hidden go greyer. `through` gets
 * the cells (y * w + x) that show what's behind, glyph and all.
 */
function composite(front: StyledLine[], behind: StyledLine[], hidden: Hidden[], figures: Array<{ x: number; y: number }>, viewport: Viewport, color: boolean, style: XrayStyle, through?: Set<number>): StyledLine[] {
  const { w, h } = viewport;
  const patches = hidden.map(c => ({ ...c.cell, ...reach(c.actor, style), you: c.actor.kind === "player" }));
  const top = Math.max(0, Math.min(...patches.map(p => p.y - Math.ceil(p.ry))) - 1);
  const bottom = Math.min(h - 1, Math.max(...patches.map(p => p.y + Math.ceil(p.ry))) + 1);
  const A: Cell[][] = [], B: Cell[][] = [];
  for (let y = top; y <= bottom; y++) {
    const a = cellsOf(front[y] ?? []), b = cellsOf(behind[y] ?? []);
    // Glyphs that aren't one cell each (the frames wouldn't line up): leave the frame as drawn.
    if (a.length !== w || b.length !== w) return front;
    A.push(a); B.push(b);
  }
  const at = (grid: Cell[][], x: number, y: number) => grid[y - top]?.[x];
  // How solid the building is at a cell: clearest round the hidden one, solid at the patch's edge.
  const opacity = (x: number, y: number) => {
    let best = 1;
    for (const p of patches) {
      const d = Math.hypot((x - p.x) / p.rx, (y - p.y) / p.ry);
      if (d < 1) best = Math.min(best, style.clear + (1 - style.clear) * smoothstep(style.core, 1, d));
    }
    return best;
  };
  const differs = (x: number, y: number) => {
    const a = at(A, x, y), b = at(B, x, y);
    return !!a && !!b && !sameCell(a, b);
  };
  const patchAt = (x: number, y: number) => patches.find(p => p.x === x && p.y === y);
  const beside = (x: number, y: number) => patches.some(p => Math.abs(p.x - x) <= 1 && p.y === y);
  const figure = (x: number, y: number) => figures.some(c => c.x === x && c.y === y);
  // The building's outline: where it meets what isn't it, or where its face turns (a jump in shade).
  const edge = (x: number, y: number) => {
    const a = at(A, x, y)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = at(A, x + dx, y + dy);
      if (!n) continue;
      if (!differs(x + dx, y + dy)) return true;
      if (color && contrast(a.bg, n.bg) > style.turn) return true;
    }
    return false;
  };
  const out = [...front];
  for (let y = top; y <= bottom; y++) {
    let changed = false;
    const row = A[y - top]!.map((a, x) => {
      const op = opacity(x, y);
      if (op >= 1 || !differs(x, y)) return a;
      changed = true;
      const b = at(B, x, y)!;
      const shows = (cell: Cell) => { through?.add(y * w + x); return cell; };
      if (patchAt(x, y)?.you) return shows(you(b, a, op, color));
      if (patchAt(x, y) || figure(x, y)) return shows(greyer(b, a, op, color));
      if (!beside(x, y) && edge(x, y)) return blend(a, b, Math.max(op, style.outline), false, color, style.grey);
      // What's behind shows through the clearer middle; the building's own texture comes back, raggedly, as it fades in.
      const behindGlyph = op < 0.62 + dither(x, y);
      const cell = blend(a, b, op, behindGlyph, color, style.grey);
      return behindGlyph ? shows(cell) : cell;
    });
    if (changed) out[y] = spansOf(row);
  }
  return out;
}

/** A building's cell over what's behind it: whose glyph shows, and the colours mixed by how solid it is there. */
function blend(a: Cell, b: Cell, op: number, behindGlyph: boolean, color: boolean, greyed: number): Cell {
  if (!color) return behindGlyph ? b : a;
  const abg = a.bg || SCREEN;
  // A floor under what shows through: the hole reads as a hole on dark roofs and at night too.
  let bbg = grey(b.bg || SCREEN, greyed, 1);
  const need = lum(abg) + 22 - lum(bbg);
  if (need > 0) bbg = mix(bbg, "#9a96a0", Math.min(1, need / Math.max(1, lum("#9a96a0") - lum(bbg))));
  const bg = mix(bbg, abg, op);
  if (behindGlyph) return { ch: b.ch, fg: mix(b.fg ? grey(b.fg, greyed, 1) : bbg, abg, op), bg, bold: b.bold };
  return { ch: a.ch, fg: mix(bbg, a.fg || abg, op), bg, bold: a.bold };
}

/** Someone behind a building: as they'd be drawn, a little greyer and dimmer, on the building's tint (but never lost in the dark). */
function greyer(b: Cell, a: Cell, op: number, color: boolean): Cell {
  if (!color) return b;
  const bg = mix(b.bg || SCREEN, a.bg || SCREEN, op * 0.8);
  return { ch: b.ch, fg: b.fg ? legible(grey(b.fg, 0.55, 0.86), bg) : b.fg, bg, bold: b.bold };
}

const lum = (c: string) => { const [r, g, b] = hex(c); return 0.3 * r + 0.59 * g + 0.11 * b; };

/** A colour lifted towards a light grey until it stands out from the background it's on. */
function legible(fg: string, bg: string): string {
  const need = lum(bg) + 70 - lum(fg);
  return need <= 0 ? fg : mix(fg, "#d0d0d0", Math.min(1, need / Math.max(1, lum("#d0d0d0") - lum(fg))));
}

/** You behind a building: a touch greyer, but on your own mark, so you're found at a glance. */
function you(b: Cell, a: Cell, op: number, color: boolean): Cell {
  if (!color) return b;
  return { ch: b.ch, fg: b.fg ? grey(b.fg, 0.5, 0.9) : b.fg, bg: mix(b.bg || SCREEN, "#6a3a8a", 0.6), bold: true };
}

/** A colour desaturated by `amount` (0..1) and dimmed by `k`. */
function grey(c: string, amount: number, k: number): string {
  const [r, g, b] = hex(c);
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  return rgb((r + (l - r) * amount) * k, (g + (l - g) * amount) * k, (b + (l - b) * amount) * k);
}

/** How different two colours look (0..1). */
function contrast(a: string, b: string): number {
  if (!a || !b) return a === b ? 0 : 1;
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b);
  return (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / (3 * 255);
}

/** An ordered dither (4x4 Bayer), so the building's glyphs come back raggedly, not in a hard ring. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.47) * 0.3;

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function cellsOf(line: StyledLine): Cell[] {
  const out: Cell[] = [];
  for (const s of line) for (const ch of s.text) out.push({ ch, fg: s.fg ?? "", bg: s.bg ?? "", bold: !!s.bold });
  return out;
}

/** Cells back to spans, merged as the renderer merges them. */
function spansOf(cells: Cell[]): StyledLine {
  const spans: Span[] = [];
  for (const c of cells) {
    const last = spans.at(-1);
    if (last && (last.fg ?? "") === c.fg && (last.bg ?? "") === c.bg && !!last.bold === c.bold) last.text += c.ch;
    else spans.push({ text: c.ch, ...(c.fg ? { fg: c.fg } : {}), ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}) });
  }
  return spans;
}

function cellAt(lines: StyledLine[], p: { x: number; y: number }): Cell | undefined {
  let col = 0;
  for (const s of lines[p.y] ?? []) {
    const chars = [...s.text];
    if (p.x < col + chars.length) return { ch: chars[p.x - col]!, fg: s.fg ?? "", bg: s.bg ?? "", bold: !!s.bold };
    col += chars.length;
  }
  return undefined;
}

const sameCell = (a: Cell | undefined, b: Cell | undefined) => !!a && !!b && a.ch === b.ch && a.fg === b.fg && a.bg === b.bg && a.bold === b.bold;
const key = (t: Tile2) => `${t.x},${t.y}`;
