// Copied from the prototype's src/game/look/door-art.ts at 44c6d4a, whole, unchanged.
/**
 * Doors as pictures, over the ASCII, in the browser: the one place the game's ASCII gets drawn art
 * (the user's call: "only do this if we have to for readability purposes, because the ascii look
 * has a real charm to it"). The art is the ASCII-plus spike's (spike/ascii-plus-2, approved: "door
 * look much more readable"), its door parts only: a flat silhouette in two or three colours, set
 * into its wall's face and sheared with it on the map, drawn into the wall's line as a plan draws a
 * door on the scene's place from above; a mark or two (a handle, the lock's brass, one bar), lit by
 * the game's light, and a dark edge only where it would vanish into what's behind it.
 *
 * This module is pure (no DOM, no game state), shared by both ends:
 *   - the game says where the doors are (src/game/look/overlay.ts: DoorShape, from what the map's
 *     renderer and the stage drew, in the screen's cells), and asks doorCells() which cells a
 *     door's picture can reach, to say which of them it may paint;
 *   - the page (src/web/page/doors.ts) draws them: paintDoor() gives the art pixels and the wall's
 *     cells given back, and the page scales them to xterm.js's cells.
 *
 * A cell is AX x AY art pixels, about the Kingmaker Glyphs' own resolution (9 x 18 to a cell), so a
 * door is a small step up from a glyph, not a picture; an art pixel is a cell's 7th across and its
 * 15th down, whatever the font size, zoom or screen.
 */

/** How a door looks: shut, open, locked, barred, or broken (smashed in, or burnt through). */
export type DoorLook = "shut" | "open" | "locked" | "barred" | "broken";

/**
 * A door's look from its states (a scene opened it, or barred it; the rules broke it) and its tile
 * (a door tile that blocks is locked unless something opened it).
 */
export function doorLook(states: readonly string[], blocks = false): DoorLook {
  if (states.includes("destroyed") || states.includes("broken")) return "broken";
  if (states.includes("open")) return "open";
  if (states.some(s => s === "barred" || s === "bolted")) return "barred";
  if (states.includes("locked") || blocks) return "locked";
  return "shut";
}

/** A cell is AX art pixels across and AY down. */
export const AX = 7, AY = 15;

/** A colour as the game sends it: "#rrggbb". */
export type Hex = string;

/**
 * A cell a door's picture may paint, and what the game drew there (for the dark edge, where the
 * picture would vanish into it): [x, y, level, colour]. Level 2: anything of the door; level 1:
 * only what stands out in front of it (an open leaf, splinters on the ground), since what's drawn
 * there is nearer than the door. Cells it may not paint (someone in front, a menu over it) aren't
 * listed.
 */
export type DoorCell = [x: number, y: number, level: 1 | 2, bg: Hex];

/** A cell the ASCII door took from its wall, given back under the picture: [x, y, glyph, fg, bg]. */
export type WallCell = [x: number, y: number, ch: string, fg: Hex, bg: Hex];

/** A door on the map (the town's isometric renderer), in its wall's face. */
export interface MapDoorShape {
  view: "map";
  id: string;
  look: DoorLook;
  /** The face it opens through: south (right of its tile's middle on screen) or west (left). */
  face: "south" | "west";
  /** Its tile's centre cell on the screen, and its wall's height in rows. */
  x: number;
  y: number;
  h: number;
  /** Its colours, lit as its wall is. */
  colors: { wood: Hex; mark: Hex; brass: Hex; bar: Hex; gap: Hex };
  cells: DoorCell[];
  wall: WallCell[];
}

/** A door on a scene's place from above (the stage), in its wall's line. */
export interface StageDoorShape {
  view: "stage";
  id: string;
  look: DoorLook;
  /** The way its wall runs (x: across the screen), and the side it opens to (1: south or east). */
  along: "x" | "y";
  side: 1 | -1;
  /** Its cell on the screen, in the wall's line. */
  x: number;
  y: number;
  /** Its width along the wall, in art pixels, and whether it's a gate or double doors (two leaves). */
  len: number;
  wide: boolean;
  colors: { wood: Hex; mark: Hex; brass: Hex; bar: Hex; floor: Hex };
  cells: DoorCell[];
}

export type DoorShape = MapDoorShape | StageDoorShape;

/** What the page is told each time it changes: the doors to draw, on a screen of so many cells. */
export interface OverlayFrame {
  cols: number;
  rows: number;
  doors: DoorShape[];
}

/** The OSC it comes in, after the frame it belongs to: ESC ] 7735 ; <the frame as JSON, in ASCII> BEL. */
export const OVERLAY_OSC = 7735;

// ---------------------------------------------------------------------------------------------
// Colours

export type RGB = [number, number, number];

export const hex = (s: string): RGB => { const n = parseInt(s.replace("#", "").slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const byte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const toHex = (c: RGB): Hex => `#${c.map(v => byte(v).toString(16).padStart(2, "0")).join("")}`;
export const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const lum = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

/**
 * Would two colours run together, one against the other, at a glance? Close in brightness and not
 * far apart in colour (brightness is what a small shape is read by).
 */
export function vanishes(a: RGB, b: RGB): boolean {
  const dl = Math.abs(lum(a) - lum(b)) * 255;
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return dl < 24 && d < 64;
}

/** The doors' own colours, before the light: on the map, and on the stage (a little warmer). */
export const MAP_DOOR = { wood: "#a46a38", dark: "#74441f", mark: "#2a1a0e", brass: "#f2c24e", bar: "#d2a468", gap: "#120d0a" } as const;
export const STAGE_DOOR = { wood: "#a8703c", dark: "#7a4a24", mark: "#2a1a0e", brass: "#f2c24e", bar: "#d2a468" } as const;

/** A stable hash of integers to 0..1. */
export function hash01(...ns: number[]): number {
  let h = 2166136261;
  for (const n of ns) { h ^= n & 0xffff; h = Math.imul(h, 16777619); h ^= n >>> 16; h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A string to an integer, for hashing a door's id (its splinters lie where they fell, wherever the camera is). */
export function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0;
  return h;
}

// ---------------------------------------------------------------------------------------------
// Sprites

/** An art pixel's key on the screen's art grid (whole pixels: a fractional position is the pixel it falls in). */
const key = (X: number, Y: number) => (Math.floor(X) + 8192) * 16384 + (Math.floor(Y) + 8192);
const unkey = (k: number): [number, number] => [Math.floor(k / 16384) - 8192, (k % 16384) - 8192];

/** One sprite's pixels, drawn flat before they're painted; later pixels overwrite earlier. */
export class Sprite {
  readonly px = new Map<number, RGB>();
  set(X: number, Y: number, c: RGB): void { this.px.set(key(X, Y), c); }
  has(X: number, Y: number): boolean { return this.px.has(key(X, Y)); }
  *each(): Generator<{ X: number; Y: number; c: RGB }> { for (const [k, c] of this.px) { const [X, Y] = unkey(k); yield { X, Y, c }; } }
  get size(): number { return this.px.size; }
}

/** A part of a door's picture: its pixels, the level of cell it may paint, and whether it takes a dark edge where it'd vanish. */
export interface Part { sprite: Sprite; level: 1 | 2; outline: boolean }

/** The cell an art pixel is in. */
const cellOf = (X: number, Y: number) => ({ x: Math.floor(X / AX), y: Math.floor(Y / AY) });

// ---------------------------------------------------------------------------------------------
// Doors on the map, set into their wall's face and sheared with it (the face climbs the screen a
// row for every two columns: about one art pixel down for one across), as the reference door is
// set into its wall: a flat silhouette, 10 across and up to 30 high, its head's corners cut round,
// in the game's own door colours, the wall's face under it given back (the WallCells).
//
//   shut     the leaf, one dark mark for the handle, a tick for each hinge
//   open     a dark gap, and the leaf swung out towards you off the far jamb, over the tile in front
//   locked   the leaf darker (the game's locked colour), one brass mark for the lock
//   barred   the leaf darker, one bar across it and past both jambs onto the wall
//   broken   a dark gap, the leaf's foot left standing with a notched top, a few splinters in front

/** The art row a map door's sill stands on at its high end: the last of its wall's above the ground, on the step it's over (its tile's centre row, sr). */
export const footY = (sr: number): number => (sr + 1) * AY - 1;

/**
 * The cells of the ground in front of a map door (on the row under its tile's centre, sr) that its
 * sill runs down into: the ground there is in the ASCII's step, where the face would meet the ground
 * if it were drawn straight. A door's picture may paint them where nothing stands or burns on them.
 */
export const footCells = (face: "south" | "west", sc: number, sr: number): Array<{ x: number; y: number }> =>
  (face === "south" ? [sc + 1, sc + 2] : [sc - 2, sc - 1]).map(x => ({ x, y: sr + 1 }));

export function mapDoorParts(d: MapDoorShape): Part[] {
  const south = d.face === "south";
  const sc = d.x, sr = d.y, height = Math.max(1, Math.min(6, d.h));
  const P = { wood: hex(d.colors.wood), mark: hex(d.colors.mark), brass: hex(d.colors.brass), bar: hex(d.colors.bar), gap: hex(d.colors.gap) };
  // Face space: u across from the door's left jamb, v up from its sill; the sill climbs with the face.
  const W = 10, H = Math.max(12, Math.min(30, height * AY - 14));
  const X0 = south ? (sc + 1) * AX - 1 : (sc - 1) * AX - 2;
  // The door stands on the ground: the ASCII draws the foot of its wall's face in steps (two columns
  // to a row), and the sill's high end (the left on a west face, which falls to the right; the right
  // on a south face) stands on the step it's over, on the last row of wall above the ground (footY).
  // The rest of the sill runs down past the step into the ground's cells in front (footCells), where
  // the face would meet the ground if it were drawn straight; the ASCII door's foot (the ▀ under its
  // tile) steps down there too.
  const Y0 = south ? footY(sr) + (W - 1) : footY(sr);
  const X = (u: number) => X0 + u, Y = (u: number, v: number) => Y0 + (south ? -u : u) - v;
  // A rounded head (kept low, so a narrow door sheared this steeply stays a door): its top two rows stepped in by two and one.
  const inset = (v: number) => (v === H - 1 ? 2 : v === H - 2 ? 1 : 0);
  const shape = (u: number, v: number) => u >= 0 && u < W && v >= 0 && v < H && u >= inset(v) && u < W - inset(v);
  // The hinges on the far side (right on a south face, left on a west one), the latch on the near.
  const hinge = south ? W - 1 : 0, latch = south ? 1 : W - 2;
  const s = new Sprite();
  const put = (u: number, v: number, c: RGB) => s.set(X(u), Y(u, v), c);
  const fill = (c: RGB) => { for (let u = 0; u < W; u++) for (let v = 0; v < H; v++) if (shape(u, v)) put(u, v, c); };

  if (d.look === "open" || d.look === "broken") {
    fill(P.gap);
    if (d.look === "open") {
      // The leaf, swung out square to the wall off the far jamb: on a south face out to the right and
      // down (towards you), on a west face out to the left and down; over the tile in front.
      const leaf = new Sprite();
      const dir = south ? 1 : -1;
      for (let k = 1; k < W; k++) for (let v = 0; v < H - (k === W - 1 ? 1 : 0); v++) leaf.set(X(hinge) + dir * k, Y(hinge, v) + k, P.wood);
      // Its handle, a mark near its free edge.
      const hv = Math.round(H * 0.45);
      for (const v of [hv, hv + 1]) leaf.set(X(hinge) + dir * (W - 3), Y(hinge, v) + W - 3, P.mark);
      return [{ sprite: s, level: 2, outline: true }, { sprite: leaf, level: 1, outline: true }];
    }
    // Smashed in: the leaf's top half gone, the dark of the doorway showing; what stands of it has a
    // notched top, level across the screen (the face's climb taken out of it): teeth two pixels
    // wide, three high, six apart. Its stile on the hinge side still stands full height.
    const teeth = [3, 3, 0, -3, -3, 0];
    for (let u = 0; u < W; u++) {
      const hu = south ? W - 1 - u : u;
      const top = hu < 2 ? H : Math.round(H * 0.46 + (south ? -1 : 1) * (u - (W - 1) / 2)) + teeth[hu % 6]!;
      for (let v = 0; v < Math.min(H, top); v++) if (shape(u, v)) put(u, v, P.wood);
    }
    // A few splinters on the ground in front, lying with the wall (where they fell: hashed on the door).
    const bits = new Sprite();
    const seed = seedOf(d.id);
    const SX = south ? (sc + 2) * AX : (sc - 3) * AX, SY = (sr + 1) * AY + 2;
    for (let k = 0; k < 5; k++) {
      const x = SX + Math.floor(hash01(seed, k, 1) * 14), y = SY + Math.floor(hash01(seed, k, 2) * 9);
      bits.set(x, y, P.wood); bits.set(x + 1, y + (south ? -1 : 1), P.wood);
    }
    return [{ sprite: s, level: 2, outline: true }, { sprite: bits, level: 1, outline: false }];
  }
  fill(P.wood);
  if (d.look === "locked") {
    // One brass mark: the lock, two wide and three high, by the latch.
    const lv = Math.round(H * 0.42);
    for (const du of [0, south ? 1 : -1]) for (let v = lv; v < lv + 3; v++) put(latch + du, v, P.brass);
  } else if (d.look === "shut") {
    // The handle: one dark mark; and the hinges, a two-pixel tick each.
    const hv = Math.round(H * 0.45);
    put(latch, hv, P.mark); put(latch, hv + 1, P.mark);
    for (const v of [Math.round(H * 0.18), Math.round(H * 0.74)]) { put(hinge, v, P.mark); put(hinge + (south ? -1 : 1), v, P.mark); }
  } else {
    // Barred: one bar across it, past both jambs onto the wall.
    const bv = Math.round(H * 0.46);
    for (let u = -3; u < W + 3; u++) for (const v of [bv, bv + 1, bv + 2]) put(u, v, P.bar);
  }
  return [{ sprite: s, level: 2, outline: true }];
}

// ---------------------------------------------------------------------------------------------
// Doors on the stage, in the wall's line, at their own size: the stage marks a door with one cell
// of its wall, but a door is a door's width (a gate twice that), so the gap is cut that wide along
// the wall and the door drawn in it as a plan draws one, flat: the leaf a bar in the gap when shut
// (one dark mark for the handle; one brass mark when locked; one bar across the inside when
// barred), swung square into the room when open, its stubs left notched in the gap when smashed.

/** A door's width along its wall, in art pixels: a door four feet (3.6), a gate or big double doors seven. */
export function stageDoorLength(scale: number, along: "x" | "y", wide: boolean): number {
  const feet = wide ? 7 : 3.6;
  const perPx = along === "x" ? scale / AX : (2 * scale) / AY;
  return Math.max(along === "x" ? AX : AY, Math.min(along === "x" ? AX * 12 : AY * 8, Math.round(feet / perPx)));
}

export function stageDoorParts(d: StageDoorShape): Part[] {
  const { along, side, len, wide } = d;
  const thick = along === "y" ? AX : AY;
  // u along the wall from the opening's start, v across it from the wall's top or left face.
  const U0 = (along === "x" ? d.x * AX + AX / 2 : d.y * AY + AY / 2) - Math.floor(len / 2);
  const V0 = along === "x" ? d.y * AY : d.x * AX;
  const at = (u: number, v: number): [number, number] => (along === "y" ? [V0 + v, U0 + u] : [U0 + u, V0 + v]);
  const P = { wood: hex(d.colors.wood), mark: hex(d.colors.mark), brass: hex(d.colors.brass), bar: hex(d.colors.bar), floor: hex(d.colors.floor) };
  // The gap: the wall cut back to the floor along the door's width (flat, no frame).
  const gap = new Sprite();
  for (let u = 0; u < len; u++) for (let v = 0; v < thick; v++) gap.set(...at(u, v), P.floor);
  const s = new Sprite();
  const put = (u: number, v: number, c: RGB) => s.set(...at(u, v), c);
  // The leaf in the gap: a flat bar three pixels thick, centred in the wall's thickness.
  const lv0 = Math.floor(thick / 2) - 1;
  const leaf = (u0: number, u1: number) => { for (let u = u0; u < u1; u++) for (let v = lv0; v < lv0 + 3; v++) put(u, v, P.wood); };
  // Out of the wall into the room it opens to: w art pixels out, at u along the wall.
  const out = (u: number, w: number, c: RGB) => put(u, side > 0 ? thick + w : -1 - w, c);
  if (d.look === "open") {
    // Swung square into the room off its hinge (a gate's two leaves off both jambs), flat bars.
    const half = Math.floor(len / 2);
    const leaves: Array<[number, number, number]> = wide ? [[0, 1, half], [len - 1, -1, len - half]] : [[0, 1, len]];
    for (const [hinge, dir, reach] of leaves) for (let w = -1; w < reach - 1; w++) for (let k = 0; k < 3; k++) out(hinge + dir * k, w, P.wood);
  } else if (d.look === "broken") {
    // Smashed: a stub on each jamb, its end notched; a couple of splinters on the floor.
    for (const [u0, u1] of [[0, 3], [len - 3, len]] as const) for (let u = u0; u < u1; u++) for (let v = lv0; v < lv0 + 3; v++) if (!((u === 2 || u === len - 3) && v === lv0 + 1)) put(u, v, P.wood);
    const seed = seedOf(d.id);
    for (let k = 0; k < 4; k++) { const u = 3 + Math.floor(hash01(seed, k) * Math.max(1, len - 6)), w = 1 + Math.floor(hash01(seed, k, 2) * 6); out(u, w, P.wood); out(u + 1, w, P.wood); }
  } else {
    // Shut: the leaf (a gate's two, meeting in the middle, a pixel's gap between).
    const half = Math.floor(len / 2);
    if (wide) { leaf(0, half); leaf(half + 1, len); } else leaf(0, len);
    const mid = wide ? half : len - 4;
    if (d.look === "locked") { for (const du of [0, 1]) for (let v = lv0; v < lv0 + 3; v++) put(mid + du, v, P.brass); }
    else if (d.look === "shut") put(mid, lv0 + 1, P.mark);
    if (d.look === "barred") {
      // One bar across the inside, past the jambs.
      const bv = side > 0 ? thick : -3;
      for (let u = -4; u < len + 4; u++) for (let k = 0; k < 2; k++) put(u, bv + k, P.bar);
    }
  }
  return [{ sprite: gap, level: 2, outline: false }, { sprite: s, level: 2, outline: true }];
}

export const doorParts = (d: DoorShape): Part[] => (d.view === "map" ? mapDoorParts(d) : stageDoorParts(d));

/**
 * The cells a door's picture reaches, from its own cell: a picture's the same wherever its door is
 * (moved a cell, it moves a cell), so it's worked out once for each kind of door (a broken one's
 * splinters lie where they fell: once for each door).
 */
const reach = new Map<string, Array<[number, number]>>();

/** Every cell a door's picture could reach (its pixels, the dark edge round them, and the wall it gives back). */
export function doorCells(d: DoorShape): Array<{ x: number; y: number }> {
  const kind = d.view === "map" ? `map|${d.face}|${d.h}|${d.look}` : `stage|${d.along}|${d.side}|${d.len}|${d.wide}|${d.look}`;
  const id = `${kind}|${d.look === "broken" ? d.id : ""}`;
  let offsets = reach.get(id);
  if (!offsets) {
    const seen = new Map<string, [number, number]>();
    for (const part of doorParts({ ...d, x: 0, y: 0 })) {
      for (const { X, Y } of part.sprite.each()) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const c = cellOf(X + dx, Y + dy);
          seen.set(`${c.x},${c.y}`, [c.x, c.y]);
        }
      }
    }
    offsets = [...seen.values()];
    if (reach.size > 2000) reach.clear();
    reach.set(id, offsets);
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const [dx, dy] of offsets) out.set(`${d.x + dx},${d.y + dy}`, { x: d.x + dx, y: d.y + dy });
  if (d.view === "map") for (const [x, y] of d.wall) out.set(`${x},${y}`, { x, y });
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------
// Painting

/** A door's picture, ready to draw: the wall's cells given back, then art pixels over them. */
export interface PaintedDoor {
  wall: WallCell[];
  pixels: Array<{ X: number; Y: number; c: RGB }>;
}

/**
 * A door's picture through the cells it may paint: the wall's cells it may give back (where it may
 * paint the door), then each part in turn, a dark pixel first just outside its silhouette wherever an
 * edge would vanish into what's already there (the cell's colour as the game drew it, or what this
 * door has painted there), and nowhere else.
 */
export function paintDoor(d: DoorShape): PaintedDoor {
  const level = new Map<string, number>();
  const ground = new Map<string, RGB>();
  for (const [x, y, l, bg] of d.cells) { level.set(`${x},${y}`, l); ground.set(`${x},${y}`, hex(bg)); }
  const wall = d.view === "map" ? d.wall.filter(([x, y]) => (level.get(`${x},${y}`) ?? 0) >= 2) : [];
  for (const [x, y, , , bg] of wall) ground.set(`${x},${y}`, hex(bg));
  const painted = new Map<number, RGB>();
  const behind = (X: number, Y: number): RGB | undefined => {
    const c = cellOf(X, Y);
    return painted.get(key(X, Y)) ?? ground.get(`${c.x},${c.y}`);
  };
  for (const part of doorParts(d)) {
    const ok = (X: number, Y: number) => { const c = cellOf(X, Y); return (level.get(`${c.x},${c.y}`) ?? 0) >= part.level; };
    const s = part.sprite;
    const edge = new Map<number, RGB>();
    if (part.outline) {
      for (const { X, Y, c } of s.each()) {
        if (!ok(X, Y)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = X + dx, ny = Y + dy;
          if (s.has(nx, ny) || !ok(nx, ny)) continue;
          const bg = behind(nx, ny);
          if (!bg || !vanishes(c, bg)) continue;
          edge.set(key(nx, ny), scale(lum(c) < lum(bg) ? c : bg, 0.42));
        }
      }
    }
    for (const [k, c] of edge) painted.set(k, c);
    for (const { X, Y, c } of s.each()) if (ok(X, Y)) painted.set(key(X, Y), c);
  }
  return { wall, pixels: [...painted].map(([k, c]) => { const [X, Y] = unkey(k); return { X, Y, c }; }) };
}
