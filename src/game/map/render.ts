import type { MapActor, Span, StoryState, StyledLine, Tile2, TileMap } from "../types.ts";
import { BLOCKS, DAYLIGHT, DEFAULT_STYLE, FIRE, GROUND, LIGHT_COLOUR, TREE, hash, mix, pick, scale, type BlockLook, type GroundLook } from "./palette.ts";
import { raiseFor } from "./looks.ts";
import { inBounds, isRoofed, isStructure, regionAt, tileAt, type MapTile, type PlaceRegion } from "./tiles.ts";

/**
 * The isometric ASCII renderer. The viewer stands to the south-west, looking north-east: a tile
 * (x, y) projects to column 2(x + y) and row (y - x), so the map's north runs up-left on screen and
 * its east up-right. Each tile owns a flat lozenge of three cells on its row plus the cell under its
 * middle, which tiles the plane in diamonds; the lozenges' bottom cells carry lattice dots, so the
 * grid reads without being drawn. Built things are blocks raised by their height in rows, painted
 * back to front: a lit top, the west face, the south face.
 *
 * Indoors, the room you're in loses its roof and its front walls (the south and west ones, between
 * you and the viewer) are cut down to a ledge, so you can see in. Outdoors nothing is cut; if a
 * building hides you, you're drawn through it.
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
  /** Animation frame: water shimmer, fire flicker, the lead's pulse. */
  tick?: number;
  /** false: plain characters, no colours (logs and tests). */
  color?: boolean;
  /** States of regions by region id, from scenes: "burning", "exploded", "scorched". */
  regionStates?: Record<string, string[]>;
  /** Lift every roof (scene and combat views show the whole place). Default: only the room you're in. */
  roofs?: boolean;
  /** Cut walls away round the focus (default true). */
  cutaway?: boolean;
  /** More tiles whose rooms open up like the focus's (a scene view: wherever its people are). */
  reveal?: Tile2[];
  /** Tiles to tint (combat: where you can move, what's in reach, a fire's spread), with an optional glyph. */
  marks?: Array<{ at: Tile2; color: string; glyph?: string }>;
  /** A selected tile, bracketed: [K] (targeting, looking). */
  cursor?: Tile2;
}

interface Cell { ch: string; fg: string; bg: string; bold: boolean; light: number; glow: boolean; depth: number }

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

/** The ground tile under a viewport cell (for mouse picking). */
export function tileAtScreen(sx: number, sy: number, camera: Tile2, viewport: Viewport): Tile2 {
  const { ox, oy } = origin(camera, viewport);
  const col = sx - ox, row = sy - oy;
  const centre = (r: number) => { const base = ((2 * r) % 4 + 4) % 4; return col - ((((col - base) % 4) + 4) % 4) + (((col - base) % 4 + 4) % 4 > 2 ? 4 : 0); };
  let c = centre(row), r = row;
  if (Math.abs(col - c) > 1) { r = row - 1; c = col; }
  const s = c / 2;
  return { x: (s - r) / 2, y: (s + r) / 2 };
}

const MAX_HEIGHT = 6;

export function render(map: TileMap, actors: MapActor[], camera: Tile2, viewport: Viewport, options: RenderOptions = {}): StyledLine[] {
  const { w, h } = viewport;
  const tick = options.tick ?? 0;
  const { ox, oy } = origin(camera, viewport);
  const blank = (): Cell => ({ ch: " ", fg: "", bg: "", bold: false, light: 1, glow: false, depth: -1e9 });
  const cells: Cell[][] = Array.from({ length: h }, () => Array.from({ length: w }, blank));
  const focus = options.focus ?? camera;
  const open = opening(map, focus, options);
  const lights = lighting(map, actors, options, tick);
  const slopes = roofSlopes(map);
  const regionStates = options.regionStates ?? {};

  // The tile currently being painted: cells it touches take its light and depth.
  let light = 1, depth = 0;
  // Where the player was drawn: if something in front painted over them, they're drawn through it.
  let me: { x: number; y: number; depth: number } | undefined;
  const put = (sx: number, sy: number, ch: string, fg: string, bg?: string, extra: { bold?: boolean; glow?: boolean } = {}) => {
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const cell = cells[sy]![sx]!;
    cell.ch = ch; cell.fg = fg; if (bg !== undefined) cell.bg = bg;
    cell.bold = !!extra.bold; cell.glow = !!extra.glow; cell.light = light; cell.depth = depth;
  };

  const marks = new Map((options.marks ?? []).map(m => [key(m.at), m]));
  /** A tinted tile: its floor takes the mark's colour (it isn't darkened at night: you need to see it). */
  const paintMark = (m: { color: string; glyph?: string }, sc: number, sr: number) => {
    for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [0, 1]] as const) {
      const sx = sc + dx, sy = sr + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const cell = cells[sy]![sx]!;
      cell.bg = mix(cell.bg || "#101014", m.color, 0.45); cell.glow = true;
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
      light = lights.at(x, y); depth = R;
      const region = regionAt(map, at);
      const states = region ? regionStates[region.id] ?? [] : [];
      paintTile(at, t, sc, sr, states);
      const mark = marks.get(key(at));
      if (mark) paintMark(mark, sc, sr);
      for (const a of order(byTile.get(key(at)) ?? [])) paintActor(a, t, at, sc, sr);
      if (options.cursor && options.cursor.x === x && options.cursor.y === y) {
        const glow = { bold: true, glow: true };
        put(sc - 1, sr, "[", "#ffe680", undefined, glow); put(sc + 1, sr, "]", "#ffe680", undefined, glow);
      }
    }
  }

  function paintTile(at: Tile2, t: MapTile, sc: number, sr: number, states: string[]): void {
    const { x, y } = at;
    const burnt = states.includes("exploded") || states.includes("burnt") || states.includes("scorched");
    const burning = states.includes("burning");
    if (t.terrain === "tree") {
      ground(at, GROUND[groundKey(t)]!, sc, sr);
      put(sc, sr, "│", TREE.trunk);
      const canopy = burning ? FIRE[(hash(x, y, tick) % 4)]! : TREE.canopy;
      for (const dx of [-1, 0, 1]) put(sc + dx, sr - 1, pick(TREE.canopyChars, x, y, dx), TREE.canopyFg, canopy);
      put(sc, sr - 2, "♣", TREE.canopyFg, canopy);
      if (burning) lightUp(sc, sr - 1);
      return;
    }
    const roofed = isRoofed(t);
    const raised = isStructure(t) || roofed;
    if (!raised) {
      ground(at, burnt ? GROUND.scorched! : GROUND[groundKey(t)]!, sc, sr);
      if (burning && hash(x, y, tick >> 1) % 3 === 0) { put(sc + (hash(x, y) % 3) - 1, sr, pick("^*▲", x, y, tick), FIRE[hash(x, y, tick) % 4]!, undefined, { glow: true }); }
      return;
    }
    const style = BLOCKS[burnt ? "burnt" : blockStyle(t)] ?? BLOCKS.stone!;
    const k = key(at);
    if (roofed && (open.lifted.has(k) || options.roofs === false)) { ground(at, burnt ? GROUND.scorched! : GROUND[groundKey(t)]!, sc, sr); return; }
    if (open.cut.has(k)) {
      ground(at, GROUND[groundKey(t)]!, sc, sr);
      if (roofed) return;
      // A front wall cut down to a stub, a section through the room; a doorway stays open.
      if (t.terrain === "door") {
        put(sc, sr, "▯", "#c08a50");
        return;
      }
      block(at, style, 1, sc, sr);
      return;
    }
    const height = Math.max(1, Math.min(MAX_HEIGHT, (roofed ? t.roofHeight ?? 3 : t.height) ?? 1));
    if (t.terrain === "door" && height <= 1) {
      // A gate in a low wall: two posts, and the gate itself when it's shut.
      ground(at, GROUND[groundKey(t)]!, sc, sr);
      put(sc - 1, sr - 1, "▄", style.top); put(sc - 1, sr, "█", style.west);
      put(sc + 1, sr - 1, "▄", style.top); put(sc + 1, sr, "█", style.south);
      const shut = !(doors.get(key(at)) ?? ["open"]).includes("open") || !!t.blocks;
      if (shut) put(sc, sr, "╪", "#9a6436");
      return;
    }
    block(at, style, height, sc, sr);
    if (t.terrain === "door") door(at, t, height, sc, sr);
    if (t.terrain === "window") windows(at, height, sc, sr);
    if (burning) for (const dx of [-1, 0, 1]) if (hash(x, y, dx, tick) % 2) put(sc + dx, sr - height - (hash(x, y, dx) % 2), pick("^*▲", x, y, dx, tick), FIRE[hash(x, y, dx, tick) % 4]!, undefined, { glow: true });
  }

  function ground(at: Tile2, look: GroundLook, sc: number, sr: number): void {
    if (!look.bg) return;
    const { x, y } = at;
    const faces = [...look.face];
    for (const dx of [-1, 0, 1]) {
      const i = look.animate ? (hash(x, y) + dx + 1 + tick) % faces.length : hash(x, y, dx) % faces.length;
      const fg = look.fg2 && hash(x, y, dx, 7) % 4 === 0 ? look.fg2 : look.fg;
      put(sc + dx, sr, faces[i]!, fg, look.bg);
    }
    put(sc, sr + 1, look.animate && (hash(x, y) + tick) % 3 === 0 ? " " : look.tip, look.fg, look.bg);
  }

  function block(at: Tile2, s: BlockLook, height: number, sc: number, sr: number): void {
    const { x, y } = at;
    const top = sr - height;
    // Roofs are two slopes and a ridge: the north and west slopes catch the light.
    const slope = slopes[y * map.width + x]!;
    const k = slope === 1 ? 1.14 : slope === 2 ? 1.3 : slope === 3 ? 0.8 : 1;
    const roof = k === 1 ? s.top : scale(s.top, k), roofFg = k === 1 ? s.topFg : scale(s.topFg, k);
    const chars = slope === 2 ? "▀" : s.topChars;
    for (const dx of [-1, 0, 1]) put(sc + dx, top, pick(chars, x, y, dx), slope === 2 ? scale(s.topFg, 1.45) : roofFg, roof);
    put(sc, top + 1, pick(chars, x, y, 9), slope === 2 ? scale(s.topFg, 1.45) : roofFg, roof);
    for (let r = top + 1; r <= sr; r++) {
      const course = r - top;
      put(sc - 1, r, s.faceChars ? pick(s.faceChars, x, y, course) : " ", s.faceFg ?? s.west, s.west);
      put(sc + 1, r, s.faceChars ? pick(s.faceChars, y, x, course) : " ", s.faceFg ?? s.south, s.south);
      if (r > top + 1) put(sc, r, " ", s.edge, s.edge);
    }
    put(sc, sr + 1, " ", s.edge, s.edge);
  }

  /** A door on whichever face it opens through: planks when shut (darker when barred), a dark gap when open. */
  function door(at: Tile2, t: MapTile, height: number, sc: number, sr: number): void {
    const through = passable(map, { x: at.x, y: at.y - 1 }) || passable(map, { x: at.x, y: at.y + 1 }) ? "south" : "west";
    const states = doors.get(key(at)) ?? [];
    const open = states.includes("open") || states.includes("destroyed");
    const locked = !open && (!!t.blocks || states.some(s => s === "locked" || s === "barred" || s === "bolted"));
    const colour = open ? "#1a1410" : locked ? "#6b3f1e" : "#9a6436";
    const col = through === "south" ? sc + 1 : sc - 1;
    for (let r = sr - Math.min(2, height - 1); r <= sr; r++) put(col, r, open ? " " : r === sr ? "▙" : "█", colour, scale(colour, 0.6));
    put(sc, sr + 1, "▀", colour, scale(colour, 0.5));
  }

  function windows(at: Tile2, height: number, sc: number, sr: number): void {
    const night = options.time === "night" || options.time === "evening";
    const glass = night ? "#ffcf6b" : "#9fc4dc";
    const r = sr - Math.max(1, Math.floor(height / 2));
    const southFacing = passable(map, { x: at.x, y: at.y + 1 });
    put(southFacing ? sc + 1 : sc - 1, r, "▪", glass, undefined, { glow: night });
  }

  function paintActor(a: MapActor, t: MapTile, at: Tile2, sc: number, sr: number): void {
    const k = key(at);
    const roofedOver = isRoofed(t) && options.roofs !== false && !open.lifted.has(k);
    if (roofedOver && a.kind !== "player") return;
    // Standing on a wall top (Moll on the yard wall) unless the wall is cut down.
    const standing = isStructure(t) && t.blocks && !open.cut.has(k) ? Math.max(0, t.height ?? 0) : 0;
    const states = a.states ?? [];
    const lift = raiseFor(a.name, states);
    const r = sr - standing - lift;
    const colour = a.color ?? "#d0d0d0";
    if (states.includes("overhead")) {
      // Bunting and the like: a string of little flags across the tile.
      for (const dx of [-1, 0, 1]) put(sc + dx, r, dx ? a.glyph : "‿", dx ? bunting(at, dx) : "#8a8070");
      return;
    }
    if (states.includes("hanging") || lift >= 2) {
      // A rope up to whatever it hangs from.
      if (states.includes("hanging")) put(sc, r - 1, "│", "#c8a878");
    }
    if (states.includes("burning")) {
      const f = (n: number) => FIRE[hash(at.x, at.y, n, tick) % FIRE.length]!;
      put(sc, r, states.includes("destroyed") ? "%" : a.glyph, "#fff2c0", f(0), { bold: true, glow: true });
      put(sc, r - 1, pick("^▲*", at.x, at.y, tick), f(1), undefined, { glow: true });
      if (hash(at.x, at.y, tick, 3) % 2) put(sc + (tick % 2 ? 1 : -1), r - 1, pick("'`*.", at.x, at.y, tick), f(2), undefined, { glow: true });
      lightUp(sc, r);
      return;
    }
    if (states.includes("destroyed")) {
      put(sc, r, states.includes("smouldering") || states.includes("burnt") ? "%" : "∴", states.includes("smouldering") ? "#c0502a" : "#8a8278");
      return;
    }
    if (states.includes("gone")) return;
    const down = states.some(s => s === "down" || s === "unconscious" || s === "dead" || s === "prone");
    if (a.kind === "player") {
      put(sc, r, "@", colour, "#3a3418", { bold: true, glow: true });
      me = { x: sc, y: r, depth };
      return;
    }
    const lit = states.includes("lit") || states.includes("light");
    const person = a.kind === "person" || a.kind === "creature";
    put(sc, r, a.glyph, down ? scale(colour, 0.6) : colour, undefined, { bold: person, glow: lit });
    // Sacks and crates come in stacks.
    if (a.glyph === "■" || a.glyph === "▣") { put(sc, r - 1, a.glyph, scale(colour, 1.1)); put(sc + (hash(at.x, at.y) % 2 ? 1 : -1), r, a.glyph, scale(colour, 0.85)); }
    if (down) put(sc + 1, r, "_", scale(colour, 0.6));
  }

  /** Something burning lights the cell it's in and stays bright at night. */
  function lightUp(sx: number, sy: number): void {
    if (sx >= 0 && sy >= 0 && sx < w && sy < h) cells[sy]![sx]!.glow = true;
  }

  // Hidden behind a building: drawn through it, picked out so it's plain that you're back there.
  if (me && me.x >= 0 && me.y >= 0 && me.x < w && me.y < h && cells[me.y]![me.x]!.depth > me.depth) {
    depth = 1e9; light = 1;
    put(me.x, me.y, "@", "#ffffff", "#6a3a8a", { bold: true, glow: true });
  }

  // The lead: a marker floating over the place the story is heading for, or an arrow at the edge.
  if (options.lead) {
    const s = screenOf(options.lead, camera, viewport);
    const t = tileAt(map, options.lead);
    const standing = isStructure(t) && t.blocks ? t.height ?? 0 : 0;
    const my = s.y - 2 - standing;
    const pulse = tick % 4 < 2;
    depth = 1e9; light = 1;
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

  // Time of day: darken what isn't lit, lean the air's colour, keep lamps and fire bright.
  const day = DAYLIGHT[options.time ?? "afternoon"];
  for (const row of cells) for (const cell of row) {
    if (cell.glow) continue;
    // Pools of lamplight: brighter than the dark round them, and warm.
    const k = Math.min(1.12, day.ambient + (1.12 - day.ambient) * cell.light);
    const warm = cell.light > 0.05 && day.ambient < 0.9 ? cell.light * 0.28 : 0;
    const shade = (c: string) => c ? mix(mix(scale(c, k), day.tint, day.tintAmount * (1 - cell.light)), LIGHT_COLOUR, warm) : c;
    cell.fg = shade(cell.fg); cell.bg = shade(cell.bg);
  }

  return cells.map(row => toSpans(row, options.color !== false));
}

function toSpans(row: Cell[], color: boolean): StyledLine {
  const spans: Span[] = [];
  for (const c of row) {
    const style = color ? { ...(c.fg ? { fg: c.fg } : {}), ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}) } : {};
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
// Light: lamps, fires and burning things light the tiles round them (it matters at night).

interface Lights { at(x: number, y: number): number }

function lighting(map: TileMap, actors: MapActor[], options: RenderOptions, tick: number): Lights {
  const day = DAYLIGHT[options.time ?? "afternoon"];
  if (day.ambient >= 0.95) return { at: () => 0 };
  const sources: Array<{ x: number; y: number; r: number }> = [];
  for (const a of actors) {
    if (a.map !== map.id) continue;
    const s = a.states ?? [];
    if (s.includes("burning")) sources.push({ ...a.at, r: 5.5 + (tick % 2) * 0.5 });
    else if (s.includes("lit") || s.includes("light")) sources.push({ ...a.at, r: 4.5 });
  }
  for (const [id, states] of Object.entries(options.regionStates ?? {})) {
    if (!states.includes("burning")) continue;
    const region = map.regions.find(r => r.id === id) as PlaceRegion | undefined;
    if (region) sources.push({ x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2, r: Math.max(region.rect.w, region.rect.h) });
  }
  // Lit windows spill a little light into the street.
  if (options.time === "night" || options.time === "evening") {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.tiles[y]![x]!.terrain === "window") sources.push({ x, y, r: 2.2 });
  }
  return {
    at(x, y) {
      let best = 0;
      for (const s of sources) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < s.r) best = Math.max(best, Math.pow(1 - d / s.r, 0.7));
      }
      return best;
    },
  };
}
