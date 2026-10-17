import type { Picks } from "../map/render.ts";
import type { StyledLine, Tile2 } from "../types.ts";
import { Canvas } from "./canvas.ts";
import { hexOf, rgbOf } from "./color.ts";
import { doorCells, hex, MAP_DOOR, OVERLAY_OSC, scale, STAGE_DOOR, stageDoorLength, toHex, type DoorCell, type DoorShape, type Hex, type MapDoorShape, type OverlayFrame, type StageDoorShape } from "./door-art.ts";
import { shadeBy } from "./light.ts";
import type { StagePicks } from "./stage.ts";

/**
 * The browser's overlay, the game's half: where the doors are in a frame the map's renderer or the
 * stage just drew, as DoorShapes (src/game/look/door-art.ts) in the frame's own cells, with the cells
 * each door's picture may paint. A door's picture goes over what's behind it and under what's in
 * front of it, as the renderer painted them: the Picks say which tile each cell shows (the map is
 * painted back to front, so a cell showing a tile nearer than the door is in front of it), who's
 * drawn there, and what was drawn over the map once it was painted (floating text, effects, the
 * pointer's highlight). On the stage, a door's picture goes over the floor and its own wall, and
 * under anyone standing there.
 *
 * Only the browser builds ask for this (KM_IN_BROWSER: src/game/look/opentui.ts attachOverlay sends
 * it to the page, after the frame it belongs to); the terminal game draws its ASCII alone.
 */

/** Whether a live view should say where its doors are (set by attachOverlay, in the browser builds). */
let wanted = false;
export const overlayWanted = (): boolean => wanted;
export function wantOverlay(on: boolean): void { wanted = on; }

/** The theme's background, where a frame leaves a cell's background to the terminal. */
const THEME_BG = "#15131a";

/** The renderer's order of painting, back to front: projected rows, then columns. */
const orderOf = (t: Tile2) => (t.y - t.x) * 100000 + (t.x + t.y);

/** A light's multipliers, a little coarse, so a lamp's flicker doesn't redraw the doors by it every frame. */
const coarse = (v: number) => Math.round(v * 32) / 32;

/** A frame's backgrounds, as drawn, by cell. */
function backgrounds(frame: Canvas | StyledLine[]): (x: number, y: number) => Hex | undefined {
  if (frame instanceof Canvas) return (x, y) => (frame.inside(x, y) ? hexOf(frame.bg[y * frame.w + x]!) : undefined);
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

/** The doors in a frame of the map (townView, fightView), from its Picks (asked for with new Picks({ doors: true })). */
export function mapDoors(picks: Picks, frame: StyledLine[]): MapDoorShape[] {
  const over = picks.over;
  if (!picks.doors || !over) return [];
  const bgAt = backgrounds(frame);
  const out: MapDoorShape[] = [];
  for (const d of picks.doors) {
    const l = { r: coarse(d.light.r), g: coarse(d.light.g), b: coarse(d.light.b) };
    const lit = (c: string) => hexOf(shadeBy(rgbOf(c), l.r, l.g, l.b, d.floor));
    const dark = d.look === "locked" || d.look === "barred";
    // The restored wall face already contains material colour, face shading and lighting.
    // Use it directly, so neither the mask nor its hardware introduces an orange palette.
    const faceColumn = d.sc + (d.face === "south" ? 1 : -1);
    const tile = hex(d.wall.find(c => c.x === faceColumn)?.bg ?? lit(MAP_DOOR.wood));
    const tint = (k: number) => toHex(scale(tile, k));
    const shape: MapDoorShape = {
      view: "map", id: `${picks.map}:door@${d.at.x},${d.at.y}`, look: d.look, face: d.face, x: d.sc, y: d.sr, h: d.height,
      colors: { wood: tint(dark ? 0.85 : 1.05), mark: tint(0.25), brass: tint(1.65), bar: tint(1.3), gap: tint(0.3) },
      cells: [], wall: d.wall.map(c => [c.x, c.y, c.ch, c.fg, c.bg]),
    };
    // Its leaf swings out over the tile in front of its face; splinters fall there. It stands on its
    // foot, the bare ground in front that the sill runs down into (as if the face were drawn straight).
    const door = orderOf(d.at), front = orderOf(d.face === "south" ? { x: d.at.x, y: d.at.y + 1 } : { x: d.at.x - 1, y: d.at.y });
    const foot = new Set(d.foot.map(c => `${c.x},${c.y}`));
    for (const { x, y } of doorCells(shape)) {
      if (x < 0 || y < 0 || x >= picks.w || y >= picks.h || over[y * picks.w + x]) continue;
      const pk = picks.at(x, y);
      let level: 0 | 1 | 2 = 2;
      if (pk) {
        // What shows there is behind the door or the door's own, or its foot (2), between it and the
        // tile in front (1), or nearer still (0); and nobody standing in the doorway or in front of it
        // is drawn over.
        const o = orderOf(pk.at);
        const being = !!pk.actor && (pk.actor.kind === "person" || pk.actor.kind === "creature" || pk.actor.kind === "player");
        level = being && (o === door || o === front) ? 0 : o <= door || foot.has(`${x},${y}`) ? 2 : o <= front ? 1 : 0;
      }
      if (level) shape.cells.push([x, y, level, bgAt(x, y) ?? THEME_BG]);
    }
    if (shape.cells.some(c => c[2] === 2)) out.push(shape);
  }
  return out;
}

/** The doors in a frame of a scene's place from above (stageView), from its StagePicks (asked for with new StagePicks({ doors: true })). */
export function stageDoors(picks: StagePicks, frame: Canvas): StageDoorShape[] {
  const covered = picks.covered;
  if (!picks.doors || !covered) return [];
  const bgAt = backgrounds(frame);
  const out: StageDoorShape[] = [];
  for (const d of picks.doors) {
    const k = coarse(d.light);
    const lit = (c: string) => toHex(scale(hex(c), k));
    const dark = d.look === "locked" || d.look === "barred";
    const shape: StageDoorShape = {
      view: "stage", id: d.id, look: d.look, along: d.along, side: d.side, x: d.x, y: d.y, len: stageDoorLength(d.scale, d.along, d.wide), wide: d.wide,
      colors: { wood: lit(dark ? STAGE_DOOR.dark : STAGE_DOOR.wood), mark: lit(STAGE_DOOR.mark), brass: lit(STAGE_DOOR.brass), bar: lit(STAGE_DOOR.bar), floor: d.floor },
      cells: [],
    };
    for (const { x, y } of doorCells(shape)) {
      if (x < 0 || y < 0 || x >= picks.w || y >= picks.h || covered[y * picks.w + x]) continue;
      shape.cells.push([x, y, 2, bgAt(x, y) ?? THEME_BG]);
    }
    if (shape.cells.length) out.push(shape);
  }
  return out;
}

/** A door moved by (dx, dy) cells: a frame's doors, from its canvas's cells to the screen's. */
export function moveDoor(d: DoorShape, dx: number, dy: number, keep: (x: number, y: number) => boolean): DoorShape | undefined {
  const cells: DoorCell[] = d.cells.flatMap(([x, y, l, bg]) => (keep(x, y) ? [[x + dx, y + dy, l, bg] as DoorCell] : []));
  if (!cells.some(c => c[2] === 2)) return undefined;
  if (d.view === "stage") return { ...d, x: d.x + dx, y: d.y + dy, cells };
  return { ...d, x: d.x + dx, y: d.y + dy, cells, wall: d.wall.flatMap(([x, y, ch, fg, bg]) => (keep(x, y) ? [[x + dx, y + dy, ch, fg, bg] as const] : [])) };
}

/** A frame of the overlay as the terminal's bytes (the OSC the page listens for: src/web/page/doors.ts): JSON with anything past ASCII escaped, so nothing in it ends the sequence early. */
export function overlaySequence(frame: OverlayFrame): string {
  const json = JSON.stringify(frame).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `\x1b]${OVERLAY_OSC};${json}\x07`;
}
