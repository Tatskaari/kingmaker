// Copied from the prototype's src/game/look/lamps.ts at 44c6d4a, whole; the map's Picks a local type (map-types.ts), MapActor, StyledLine and Tile2 from client/ui/types.ts.
import type { Picks } from "./map-types.ts";
import type { MapActor, StyledLine, Tile2 } from "../ui/types.ts";
import type { Look, TimeOfDay } from "./appearance.ts";
import { BEING, GLOW, UNLIT, type Canvas } from "./canvas.ts";
import { hexOf, rgbOf } from "./color.ts";
import type { Hex } from "./door-art.ts";
import { glowReach, isLampPost, isNight, lampColors, lampLook, lampReach, type LampCell, type LampShape } from "./lamp-art.ts";
import { shadeBy, type LightField } from "./light.ts";

/**
 * The browser's overlay, the lamp posts' half (the doors' is overlay.ts): where the lamp posts are
 * in a frame the map's renderer or the stage just drew, as LampShapes (src/game/look/lamp-art.ts) in
 * the frame's own cells, with the cells each lamp's picture may paint, by the doors' rules: not over
 * what's nearer (the map is painted back to front), anyone, or what's drawn over the view (effects,
 * floating text, the pointer's highlight); and its glow likewise. The cells the game drew the lamp's
 * glyph and post in are taken back to the ground they were drawn on, as it was before them.
 *
 * Only the browser builds ask (src/game/look/opentui.ts attachOverlay, with the doors); the terminal
 * game draws its ASCII alone.
 */

/** The theme's background, where a frame leaves a cell's background to the terminal (overlay.ts's). */
const THEME_BG = "#15131a";

/** The renderer's order of painting, back to front (overlay.ts's): projected rows, then columns. */
const orderOf = (t: Tile2) => (t.y - t.x) * 100000 + (t.x + t.y);

const isBeing = (a: MapActor | undefined) => !!a && (a.kind === "person" || a.kind === "creature" || a.kind === "player");

/**
 * The light on a lamp's colours: the light on its tile, but never more than 1.3 times as bright as
 * they're painted. A lit lamp's own light is on its tile too, and would wash its post out to white.
 */
const MOST = 1.3;
const capped = (l: { r: number; g: number; b: number }) => ({ r: Math.min(MOST, l.r), g: Math.min(MOST, l.g), b: Math.min(MOST, l.b) });

/**
 * Something the map's renderer drew up a post (src/game/map/render.ts), for the overlay: who it is,
 * where its glyph went (its post in the cell under it), how it looks (the look's role, and whether
 * it sheds light), the time of day, the light on its tile and the least of it the post keeps, and
 * the two cells it was drawn in as they were before it, lit as the game lit them: the ground the
 * picture goes on.
 */
export interface LampPick {
  actor: MapActor;
  at: Tile2;
  x: number;
  y: number;
  role: string;
  sheds: boolean;
  time: string;
  light: { r: number; g: number; b: number };
  floor: number;
  ground: [Hex | undefined, Hex | undefined];
}

/** A frame's backgrounds, as drawn, by cell (styled lines). */
function backgrounds(frame: StyledLine[]): (x: number, y: number) => Hex | undefined {
  const rows = new Map<number, Array<string | undefined>>();
  return (x, y) => {
    let row = rows.get(y);
    if (!row) {
      row = [];
      for (const span of frame[y] ?? []) for (const _ of span.text) row.push(span.bg);
      rows.set(y, row);
    }
    return row[x];
  };
}

/** The lamp posts in a frame of the map (townView, fightView), from its Picks (asked for with new Picks({ doors: true })). */
export function mapLamps(picks: Picks, frame: StyledLine[]): LampShape[] {
  const over = picks.over;
  if (!picks.lamps || !over) return [];
  const bgAt = backgrounds(frame);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < picks.w && y < picks.h;
  const out: LampShape[] = [];
  for (const l of picks.lamps) {
    const states = l.actor.states ?? [];
    if (!isLampPost("map", l.role, states)) continue;
    const look = lampLook(states, l.sheds, isNight(l.time));
    if (!look) continue;
    // Its own two cells, where they still show it (nobody standing in front of its post, nothing drawn over it).
    const own = (x: number, y: number) => inside(x, y) && !over[y * picks.w + x] && picks.at(x, y)?.actor?.id === l.actor.id;
    const ground: LampCell[] = [];
    l.ground.forEach((bg, k) => { if (bg && own(l.x, l.y + k)) ground.push([l.x, l.y + k, bg]); });
    if (!ground.length) continue;
    // Anywhere else: what's behind it or on its own tile, never anyone, nor what's drawn over the map.
    const order = orderOf(l.at);
    const may = (x: number, y: number) => {
      if (!inside(x, y) || over[y * picks.w + x]) return false;
      const pk = picks.at(x, y);
      return !pk || (!isBeing(pk.actor) && orderOf(pk.at) <= order);
    };
    const mine = new Set([`${l.x},${l.y}`, `${l.x},${l.y + 1}`]);
    const taken = new Map(ground.map(([x, y, bg]) => [`${x},${y}`, bg]));
    const light = capped(l.light);
    const shape: LampShape = {
      view: "map", id: l.actor.id, look, x: l.x, y: l.y, post: 1,
      colors: lampColors(look, c => hexOf(shadeBy(rgbOf(c), light.r, light.g, light.b, l.floor))),
      cells: [], ground,
    };
    for (const [x, y] of lampReach(shape)) {
      const bg = taken.get(`${x},${y}`);
      if (bg) shape.cells.push([x, y, bg]);
      else if (!mine.has(`${x},${y}`) && may(x, y)) shape.cells.push([x, y, bgAt(x, y) ?? THEME_BG]);
    }
    if (look === "lit") shape.glow = glowReach(shape).filter(([x, y]) => taken.has(`${x},${y}`) || (!mine.has(`${x},${y}`) && may(x, y)));
    out.push(steady(shape));
  }
  return out;
}

/**
 * The lamp posts on a scene's place from above, as the stage drew them (renderStage calls this as
 * it finishes a frame for the browser's overlay, before what stands on the floor is marked as
 * covering it: `covered` is only what's drawn over the floor and the things on it then, effects,
 * the pointer's highlight, floating text). Each in the cell it was drawn in, where nothing's drawn
 * over it; its floor as the light left it; its glow anywhere but on people or what's drawn over.
 */
export function stageLampsDrawn(s: {
  w: number; h: number; canvas: Canvas; field: LightField; covered: Uint8Array; owner: Int32Array; ids: string[];
  things: Array<{ e: { id: string; states: string[] }; look: Look; c: { x: number; y: number } }>; time?: TimeOfDay;
}): LampShape[] {
  const { w, h, canvas, field, covered, owner, ids } = s;
  const out: LampShape[] = [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  for (const { e, look, c } of s.things) {
    if (!isLampPost("stage", look.role, e.states)) continue;
    const lamp = lampLook(e.states, !!look.light, isNight(s.time));
    if (!lamp || !inside(c.x, c.y)) continue;
    const i = c.y * w + c.x;
    if (covered[i] || ids[owner[i]!] !== e.id) continue;
    const here = { r: field.r[i]!, g: field.g[i]!, b: field.b[i]! };
    // A lit lamp glows, so the light passed its cell by: its floor as the light has the floor round it.
    const floor = canvas.flags[i]! & (GLOW | UNLIT) ? shadeBy(canvas.bg[i]!, here.r, here.g, here.b, 0) : canvas.bg[i]!;
    const light = capped(here);
    const free = (x: number, y: number) => inside(x, y) && !covered[y * w + x] && !(canvas.flags[y * w + x]! & BEING);
    const shape: LampShape = {
      view: "stage", id: e.id, look: lamp, x: c.x, y: c.y, post: 0,
      colors: lampColors(lamp, hx => hexOf(shadeBy(rgbOf(hx), light.r, light.g, light.b, 0))),
      cells: [], ground: [[c.x, c.y, hexOf(floor)]],
    };
    for (const [x, y] of lampReach(shape)) {
      if (x === c.x && y === c.y) shape.cells.push([x, y, hexOf(floor)]);
      // Its dark edge only onto bare floor (nothing drawn there for the mouse).
      else if (free(x, y) && owner[y * w + x]! < 0) shape.cells.push([x, y, hexOf(canvas.bg[y * w + x]!)]);
    }
    if (lamp === "lit") shape.glow = glowReach(shape).filter(([x, y]) => (x === c.x && y === c.y) || free(x, y));
    out.push(steady(shape));
  }
  return out;
}

/** The lamp posts in a frame of a scene's place from above (stageView), from its StagePicks (asked for with new StagePicks({ doors: true })). */
export function stageLamps(picks: { lamps?: LampShape[] }): LampShape[] {
  return picks.lamps ?? [];
}

/** A lamp moved by (dx, dy) cells, keeping only the cells `keep` says still show its view: a frame's lamps, from its canvas's cells to the screen's. */
export function moveLamp(l: LampShape, dx: number, dy: number, keep: (x: number, y: number) => boolean): LampShape | undefined {
  const move = (cells: LampCell[]) => cells.flatMap(([x, y, bg]) => (keep(x, y) ? [[x + dx, y + dy, bg] as LampCell] : []));
  const ground = move(l.ground);
  if (!ground.length) return undefined;
  const moved: LampShape = { ...l, x: l.x + dx, y: l.y + dy, cells: move(l.cells), ground };
  if (l.glow) moved.glow = l.glow.flatMap(([x, y]) => (keep(x, y) ? [[x + dx, y + dy] as [number, number]] : []));
  return moved;
}

// ---------------------------------------------------------------------------------------------
// Steady: a lamp's own flicker (and the ground's under it) moves its colours by a shade every
// frame, which would have the page told again every frame. A lamp keeps the colours it was last
// sent with until they've moved by more than a shade anyone can see, so nothing goes while you
// stand still (as the doors' light is coarse: overlay.ts).

/** How far a colour may drift (per channel, of 255) and the lamp still be sent as it was. */
const DRIFT = 10;
const last = new Map<string, LampShape>();

const near = (a: Hex, b: Hex) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return Math.abs(((x >> 16) & 255) - ((y >> 16) & 255)) <= DRIFT && Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) <= DRIFT && Math.abs((x & 255) - (y & 255)) <= DRIFT;
};
const placed = (c: LampCell[]) => c.map(([x, y]) => `${x},${y}`).join(" ");
const tints = (l: LampShape) => [l.colors.iron, l.colors.frame, l.colors.glass, ...l.cells.map(c => c[2]), ...l.ground.map(c => c[2])];

/** The lamp as last sent, if it's where it was, looks as it did, and its colours have only drifted; else this one, kept. */
function steady(l: LampShape): LampShape {
  const key = `${l.view}:${l.id}`;
  const was = last.get(key);
  if (was && was.x === l.x && was.y === l.y && was.look === l.look && placed(was.cells) === placed(l.cells) && placed(was.ground) === placed(l.ground)
    && JSON.stringify(was.glow ?? null) === JSON.stringify(l.glow ?? null)) {
    const a = tints(was), b = tints(l);
    if (a.every((c, i) => near(c, b[i]!))) return was;
  }
  if (last.size > 512) last.clear();
  last.set(key, l);
  return l;
}
