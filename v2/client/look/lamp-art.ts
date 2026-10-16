// Copied from the prototype's src/game/look/lamp-art.ts at 44c6d4a, whole, unchanged.
import { AX, AY, hex, scale, Sprite, toHex, vanishes, type Hex, type OverlayFrame, type RGB } from "./door-art.ts";

/**
 * Lamp posts as pictures over the ASCII, in the browser: after the doors, the one other thing the
 * game's ASCII gets drawn art for (of the ASCII-plus spike's lamp post: "this is really nice let's
 * get these in the game"; detail art sparingly, only where it helps, the ASCII everywhere else).
 * The art is the spike's lamp (spike/ascii-plus-2, src/spikes/ascii-plus/detail.ts lamp()): a thin
 * post, and a lantern where the game draws the lamp (its ¤), a flat silhouette in the lamp's paint
 * with its glass as one mark, pale by day, lit after dark (a warm mark, and a small glow round it).
 * Lamp posts only (the spike's rule): not lanterns on hooks, candles or braziers.
 *
 * Pure (no DOM, no game state), on the doors' art grid (door-art.ts: a cell is AX x AY art pixels,
 * so a lamp is the same small step up from a glyph as a door), and shared by both ends as the
 * doors' art is:
 *   - the game says where the lamp posts are (src/game/look/lamps.ts: LampShape, from what the
 *     map's renderer and the stage drew, in the screen's cells), with the cells each may paint, in
 *     the doors' OSC (LampFrame);
 *   - the page (src/web/page/lamps.ts) draws them: paintLamp() gives the ground taken back under the
 *     game's glyph and post, the art pixels, and a lit lamp's glow.
 */

/** How a lamp looks: lit, out, or broken (its glass gone, no light). */
export type LampLook = "lit" | "out" | "broken";

/** States that say how a lamp's light is, whatever the hour: lit, put out, soaked, burning. */
const OWN = new Set(["lit", "unlit", "out", "wet", "soaked", "burning", "smouldering"]);

/**
 * A lamp's look: its own state where the world has one (lit, out, broken: the action menu's Light
 * lights one, water puts one out, a scene's stage manager does either), with `sheds` (whether the
 * game's look has it shedding light) saying which, by day or night; otherwise the time of day, as
 * the spike had it: lit after dark (if the game lights anything round it), pale by day. Undefined
 * for a lamp that's gone or destroyed (the ASCII draws its wreck).
 */
export function lampLook(states: readonly string[], sheds: boolean, night: boolean): LampLook | undefined {
  if (states.includes("destroyed") || states.includes("gone")) return undefined;
  if (states.includes("broken") || states.includes("smashed")) return "broken";
  if (states.some(s => OWN.has(s))) return sheds ? "lit" : "out";
  return night && sheds ? "lit" : "out";
}

/** The evening and the night are dark: a lamp with nothing said of it is lit then (the town lights its lamps at dusk). */
export const isNight = (time: string | undefined): boolean => time === "evening" || time === "night";

/**
 * Whether something the game drew is a lamp post (the spike's rule: a lamp that stands on a post).
 * On the map, what the renderer drew up a post (the "post" state) that's a lamp (the look's lamp
 * post or lantern, or the map's "lamp"); on the stage, which draws no posts, a lamp post by its look,
 * or a lamp the map has on a post.
 */
export function isLampPost(view: "map" | "stage", role: string, states: readonly string[]): boolean {
  const lamp = role === "lamp-post" || role === "lantern" || states.includes("lamp");
  return view === "map" ? states.includes("post") && lamp : role === "lamp-post" || (states.includes("post") && lamp);
}

/** A cell a lamp's picture may paint, and what's there under it (for the dark edge): [x, y, bg]. */
export type LampCell = [x: number, y: number, bg: Hex];

/** A lamp post on the map (the town's isometric renderer) or on a scene's place from above (the stage). */
export interface LampShape {
  view: "map" | "stage";
  id: string;
  look: LampLook;
  /** The cell the game drew the lamp's glyph in: the lantern goes there. */
  x: number;
  y: number;
  /** Rows of post under that cell, down to its foot: 1 on the map (the cell the game drew the post in), 0 on the stage (which draws a lamp in one cell: a short post in it, under the lantern). */
  post: 0 | 1;
  /** Its colours, lit as the game lit it there: the post, the lantern's frame, its glass. */
  colors: { iron: Hex; frame: Hex; glass: Hex };
  /** The cells its picture may paint (not over what's nearer, anyone, or what's drawn over the view), and what's there. */
  cells: LampCell[];
  /** The cells the game drew it in (its glyph, its post), taken back to the ground there before the picture: [x, y, the ground's colour]. */
  ground: LampCell[];
  /** Lit: the cells its glow may light (by the same rules: never anyone, nor what's nearer or drawn over the view). */
  glow?: Array<[x: number, y: number]>;
}

/** What the page is told each time the doors or the lamps change: the doors' frame (door-art.ts), and the lamp posts in view, when there are any. */
export interface LampFrame extends OverlayFrame {
  lamps?: LampShape[];
}

/**
 * The lamps' own colours, before the light: unlit, the town's lamp posts' paint (freshly painted
 * for the Assembly: their glyph's colour, dimmed as the look dims a lamp that's out); lit, its flame
 * (the fire ramp at the middle of the glyph's flicker: the spike's post took the flickering glyph's
 * colour, and this holds it still); the glass lit and unlit, a broken lamp's hole, and the glow.
 */
export const LAMP = { paint: "#a78a51", flame: "#ffb91d", glass: "#ffc262", pale: "#c4d0d4", gap: "#120d0a", glow: "#ffaa48" } as const;

/**
 * The glow round a lit lantern: its radius in cell widths, and how strong it is at its middle (the
 * spike's, at the top of its flicker). The spike's second glow, a pool on the ground round the
 * post's foot, is left out: the game's own light already lights the ground round a lamp.
 */
export const GLOW = { radius: 1.8, k: 0.45 } as const;

/** Where a lamp's parts go, in art pixels: the lantern's left and top, and the post's foot. */
export function lampFrame(l: Pick<LampShape, "x" | "y" | "post">): { X: number; top: number; foot: number } {
  return { X: l.x * AX + 1, top: l.post ? l.y * AY + 4 : l.y * AY + 1, foot: (l.y + 1 + l.post) * AY - 1 };
}

/** The glow's middle (the lantern's glass), in art pixels. */
export function glowCentre(l: Pick<LampShape, "x" | "y" | "post">): { X: number; Y: number } {
  const { X, top } = lampFrame(l);
  return { X: X + 2.5, Y: top + 3 };
}

/**
 * The cells a lamp's glow could reach round its lantern (GLOW.radius cell widths, taken a little
 * taller than cells are wide, to be sure of the page's circle at any cell size): the game keeps
 * those it may light.
 */
export function glowReach(l: Pick<LampShape, "x" | "y" | "post">): Array<[number, number]> {
  const c = glowCentre(l);
  const rx = GLOW.radius * AX, ry = GLOW.radius * AX * 1.2;
  const out: Array<[number, number]> = [];
  for (let y = Math.floor((c.Y - ry) / AY); y <= Math.floor((c.Y + ry) / AY); y++) {
    for (let x = Math.floor((c.X - rx) / AX); x <= Math.floor((c.X + rx) / AX); x++) {
      // The nearest point of the cell to the middle, within the ellipse.
      const nx = Math.max(x * AX, Math.min(c.X, (x + 1) * AX)), ny = Math.max(y * AY, Math.min(c.Y, (y + 1) * AY));
      if (((nx - c.X) / rx) ** 2 + ((ny - c.Y) / ry) ** 2 < 1) out.push([x, y]);
    }
  }
  return out;
}

/**
 * A lamp's picture, flat (the spike's): the post a pixel wide from the lantern down to its foot,
 * a pixel of foot either side; the lantern five across and six down, its frame a shade lighter than
 * the post, its glass one mark in its middle: warm when lit, pale when out; broken, a dark hole and
 * the frame knocked in at a corner.
 */
export function lampSprite(l: LampShape): Sprite {
  const { X, top, foot } = lampFrame(l);
  const P = { iron: hex(l.colors.iron), frame: hex(l.colors.frame), glass: hex(l.colors.glass) };
  const s = new Sprite();
  for (let y = top + 6; y <= foot; y++) s.set(X + 2, y, P.iron);
  s.set(X + 1, foot, P.iron); s.set(X + 3, foot, P.iron);
  const rows = l.look === "broken"
    ? ["..i..", ".ii..", ".ig..", ".igi.", ".iii.", "..i.."]
    : ["..i..", ".iii.", ".igi.", ".igi.", ".iii.", "..i.."];
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === "i") s.set(X + i, top + j, P.frame);
    else if (ch === "g") s.set(X + i, top + j, P.glass);
  }));
  return s;
}

/** Every cell a lamp's picture could reach from its own cell: its pixels, and the dark edge round them. */
export function lampReach(l: Pick<LampShape, "x" | "y" | "post">): Array<[number, number]> {
  const { X, top, foot } = lampFrame(l);
  const seen = new Map<string, [number, number]>();
  for (let Y = top - 1; Y <= foot + 1; Y++) for (let x = X - 1; x <= X + 5; x++) {
    const c: [number, number] = [Math.floor(x / AX), Math.floor(Y / AY)];
    seen.set(`${c[0]},${c[1]}`, c);
  }
  return [...seen.values()];
}

const lum = (c: RGB) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

/** A lamp's picture, ready to draw: the ground taken back, the art pixels over it, and (lit) its glow. */
export interface PaintedLamp {
  ground: LampCell[];
  pixels: Array<{ X: number; Y: number; c: RGB }>;
  /** The glow: its middle in art pixels, its radius in cell widths, colour and strength, and the cells it may light. */
  glow?: { X: number; Y: number; radius: number; color: Hex; k: number; cells: Array<[number, number]> };
}

/**
 * A lamp's picture through the cells it may paint: the ground under the game's glyph and post, then
 * the sprite, a dark pixel first just outside it wherever an edge would vanish into what's there (as
 * the doors' are: paintDoor), and nowhere else; and when it's lit, its glow.
 */
export function paintLamp(l: LampShape): PaintedLamp {
  const may = new Map<string, Hex>();
  for (const [x, y, bg] of l.cells) may.set(`${x},${y}`, bg);
  for (const [x, y, bg] of l.ground) if (may.has(`${x},${y}`)) may.set(`${x},${y}`, bg);
  const ground = l.ground.filter(([x, y]) => may.has(`${x},${y}`));
  const ok = (X: number, Y: number) => may.has(`${Math.floor(X / AX)},${Math.floor(Y / AY)}`);
  const s = lampSprite(l);
  const pixels: PaintedLamp["pixels"] = [];
  const edge = new Map<string, { X: number; Y: number; c: RGB }>();
  for (const { X, Y, c } of s.each()) {
    if (!ok(X, Y)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = X + dx, ny = Y + dy;
      if (s.has(nx, ny) || !ok(nx, ny)) continue;
      const bg = hex(may.get(`${Math.floor(nx / AX)},${Math.floor(ny / AY)}`)!);
      if (!vanishes(c, bg)) continue;
      edge.set(`${nx},${ny}`, { X: nx, Y: ny, c: scale(lum(c) < lum(bg) ? c : bg, 0.42) });
    }
  }
  pixels.push(...edge.values());
  for (const { X, Y, c } of s.each()) if (ok(X, Y)) pixels.push({ X, Y, c });
  const out: PaintedLamp = { ground, pixels };
  if (l.look === "lit" && l.glow?.length) {
    const c = glowCentre(l);
    out.glow = { X: c.X, Y: c.Y, radius: GLOW.radius, color: LAMP.glow, k: GLOW.k, cells: l.glow };
  }
  return out;
}

/** A lamp's colours, from its look and the light on it (`lit`, as the game lights the post): the post and the frame in its paint or its flame, a shade under it, and its glass. */
export function lampColors(look: LampLook, lit: (c: Hex) => Hex): LampShape["colors"] {
  const paint = hex(look === "lit" ? LAMP.flame : LAMP.paint);
  return {
    iron: lit(toHex(scale(paint, 0.64))),
    frame: lit(toHex(scale(paint, 0.8))),
    // Lit, the glass is its own light; out, it's pale glass in whatever light there is; broken, a hole.
    glass: look === "lit" ? LAMP.glass : lit(look === "out" ? LAMP.pale : LAMP.gap),
  };
}
