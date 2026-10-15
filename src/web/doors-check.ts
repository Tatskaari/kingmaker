import type { Page } from "playwright";
import { OVERLAY_OSC } from "../game/look/door-art.ts";

/**
 * What the browser checks ask of the doors' pictures (src/web/page/doors.ts), in either build: the
 * static build's (src/web/static/check.ts) and the server's (src/web/check.ts).
 */

export interface DoorsSeen { received: number; drawn: number; doors: Array<{ id: string; view: string; look: string; x: number; y: number; cells: number }> }

/** The doors the game last said are in view (km.doors), and how many the page drew; undefined with ?doors=off. */
export const doorsSeen = (page: Page) => page.evaluate(`(() => {
  const d = km.doors;
  if (!d) return undefined;
  return { received: d.received, drawn: d.drawn, doors: (d.frame ? d.frame.doors : []).map(x => ({ id: x.id, view: x.view, look: x.look, x: x.x, y: x.y, cells: x.cells.length })) };
})()`) as Promise<DoorsSeen | undefined>;

/** Waits for the page to draw at least `least` doors (and the one called `id`, if given); the doors last seen. */
export async function doorsDrawn(page: Page, least: number, id?: string, timeout = 10000): Promise<DoorsSeen | undefined> {
  const end = Date.now() + timeout;
  let seen: DoorsSeen | undefined;
  for (;;) {
    seen = await doorsSeen(page);
    if (seen && seen.drawn >= least && (!id || seen.doors.some(d => d.id === id))) return seen;
    if (Date.now() > end) return seen;
    await new Promise(r => setTimeout(r, 200));
  }
}

export interface Placement { drawn: number; outside: number; cellsInside: number; drawnInside: number; sameBox: boolean; size: string; device: string; cell: string; dpr: number }

/**
 * Where the doors' pictures are, against xterm.js: the overlay's canvas over its WebGL canvas (the
 * same box, as many device pixels), and every pixel drawn on it in a cell the game said a door may
 * paint (its cells, or the wall it gives back: of the doors drawn there now). With a box of cells (a
 * menu's), the doors' cells and the pixels drawn within it.
 */
export const placement = (page: Page, inside?: { left: number; top: number; right: number; bottom: number }) => page.evaluate(`((inside) => {
  const d = km.doors, frame = d.drawnFrame, cell = d.cell;
  const gl = [...document.querySelectorAll("#terminal canvas")].find(c => !c.className);
  const a = d.canvas.getBoundingClientRect(), b = gl ? gl.getBoundingClientRect() : a;
  const device = km.term._core._renderService.dimensions.device.canvas;
  const listed = new Set();
  let cellsInside = 0;
  const within = (x, y) => inside && x >= inside.left && x <= inside.right && y >= inside.top && y <= inside.bottom;
  for (const door of frame ? frame.doors : []) {
    for (const [x, y] of door.cells) { listed.add(x + "," + y); if (within(x, y)) cellsInside++; }
    for (const [x, y] of door.wall || []) { listed.add(x + "," + y); if (within(x, y)) cellsInside++; }
  }
  // The lamp posts share the canvas (src/web/page/lamps.ts): their cells, and their glow's.
  for (const lamp of frame && frame.lamps ? frame.lamps : []) {
    for (const [x, y] of [...lamp.cells, ...(lamp.glow || [])]) { listed.add(x + "," + y); if (within(x, y)) cellsInside++; }
  }
  const pixels = d.canvas.getContext("2d").getImageData(0, 0, d.canvas.width, d.canvas.height).data;
  let drawn = 0, outside = 0, drawnInside = 0;
  for (let i = 0, n = d.canvas.width * d.canvas.height; i < n; i++) {
    if (!pixels[i * 4 + 3]) continue;
    drawn++;
    const x = Math.floor((i % d.canvas.width) / cell.width), y = Math.floor(Math.floor(i / d.canvas.width) / cell.height);
    if (!listed.has(x + "," + y)) outside++;
    if (within(x, y)) drawnInside++;
  }
  const same = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
  return { drawn, outside, cellsInside, drawnInside, sameBox: same, size: d.canvas.width + "x" + d.canvas.height, device: device.width + "x" + device.height, cell: cell.width + "x" + cell.height, dpr: devicePixelRatio };
})(${JSON.stringify(inside ?? null)})`) as Promise<Placement>;

/** Whether the pictures sit where they should: some drawn, none outside their cells, on a canvas exactly over xterm's at this scale. */
export const placed = (p: Placement, scale: number) => p.drawn > 0 && !p.outside && p.sameBox && p.size === p.device && Math.abs(p.dpr - scale) < 0.01;

export interface DoorSync { taken: number; takenOff: number; drawn: number; drawnOff: number; cells: number; worst: string[]; bytes: number }

/**
 * In step with the frames: each time the page takes the doors (once xterm has parsed the frame after
 * them), and each time xterm draws, the cells the doors may paint must show the frame the game worked
 * them out from (their colours, in xterm's buffer: the map scrolls under you as you walk, so a door a
 * frame out of place would be on other cells). Installed once on a page; read with doorSync().
 */
export const watchDoorSync = (page: Page) => page.evaluate(`(() => {
  if (window.doorSync) return;
  const sync = window.doorSync = { taken: 0, takenOff: 0, drawn: 0, drawnOff: 0, cells: 0, worst: [], bytes: 0 };
  const term = km.term;
  let waiting;
  const near = (a, b) => Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) <= 4 && Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) <= 4 && Math.abs((a & 255) - (b & 255)) <= 4;
  const off = frame => {
    const buffer = term.buffer.active;
    let cells = 0, wrong = 0;
    for (const door of frame.doors) for (const [x, y, , bg] of door.cells) {
      const cell = buffer.getLine(buffer.viewportY + y)?.getCell(x);
      if (!cell) continue;
      cells++;
      if (!cell.isBgRGB() || !near(cell.getBgColor(), parseInt(bg.slice(1), 16))) wrong++;
    }
    sync.cells += cells;
    return wrong;
  };
  term.parser.registerOscHandler(${OVERLAY_OSC}, data => { sync.bytes += data.length + 8; try { waiting = JSON.parse(data); } catch {} return false; });
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, params => {
    if (waiting && params.some(p => p === 2026 || (Array.isArray(p) && p[0] === 2026))) {
      const wrong = off(waiting);
      sync.taken++;
      if (wrong) { sync.takenOff++; sync.worst.push("taken: " + wrong); }
      waiting = undefined;
    }
    return false;
  });
  term.onRender(() => {
    const frame = km.doors && km.doors.frame;
    if (!frame || frame.cols !== term.cols || frame.rows !== term.rows) return;
    const wrong = off(frame);
    sync.drawn++;
    if (wrong) { sync.drawnOff++; sync.worst.push("drawn: " + wrong); }
  });
})()`);

export const doorSync = (page: Page) => page.evaluate("window.doorSync") as Promise<DoorSync>;
