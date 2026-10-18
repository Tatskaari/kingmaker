// Copied from the prototype's src/web/page/doors.ts at 44c6d4a, whole (M5): the art is the client's (client/look/door-art.ts), and the build bundles it for the page as doors.js (hosts/web/build.ts), which page.js imports.
import { AX, AY, OVERLAY_OSC, paintDoor, toHex, type DoorShape, type OverlayFrame, type WallCell } from "../../client/look/door-art.ts";
import { drawLamps } from "./lamps.ts";

/**
 * The doors as pictures over the game's ASCII, in the page (docs/browser-design.md, M5): a canvas
 * laid exactly over xterm.js's screen, on which each door the game says is in view is drawn with the
 * ASCII-plus spike's art (client/look/door-art.ts). Only doors: everything else is the ASCII as the
 * game draws it.
 *
 *   - The game says where the doors are with each frame that changes them, in an OSC sequence
 *     (ESC ] 7735 ; <JSON> BEL) in the terminal's bytes just before the frame's own. It's held until
 *     xterm.js has parsed the end of that frame (its synchronized output's end, CSI ? 2026 l, after
 *     which xterm draws the frame all at once), and taken then: xterm's drawing of the frame and this
 *     one come in the same animation frame, so walking, the map following you and its animation never
 *     show a door a frame out of place, however the bytes were split on the way.
 *   - A door's picture paints only the cells the game says it may (what's in front of it, someone in
 *     the doorway, a menu over the map: whatever's drawn over it there keeps its cells), and gives
 *     back the wall the ASCII door was drawn on, glyphs and all, under it.
 *   - It's drawn at xterm's own device pixels (its cell size, the device pixel ratio), an art pixel a
 *     cell's 7th across and 15th down, nearest-neighbour, so it's crisp at any font size and zoom.
 *   - ?doors=off leaves the ASCII alone. A selection (Shift+drag) puts the doors away while it's there.
 *   - The lamp posts the game says are in view come in the same sequence, and are drawn on the same
 *     canvas after the doors, by the same rules (web/page/lamps.ts).
 */

/** The parts of xterm.js this needs (its public API, and the render service's dimensions). */
interface Term {
  cols: number;
  rows: number;
  element?: HTMLElement;
  options: { fontFamily?: string; fontSize?: number };
  parser: {
    registerOscHandler(ident: number, callback: (data: string) => boolean | Promise<boolean>): { dispose(): void };
    registerCsiHandler(id: { prefix?: string; final: string }, callback: (params: Array<number | number[]>) => boolean | Promise<boolean>): { dispose(): void };
  };
  onResize(listener: () => void): unknown;
  onRender(listener: () => void): unknown;
  onSelectionChange(listener: () => void): unknown;
  hasSelection(): boolean;
  buffer: { onBufferChange(listener: () => void): unknown };
}

interface Dimensions { cols: number; rows: number; cellW: number; cellH: number; width: number; height: number; cssWidth: number; cssHeight: number; dpr: number }

export interface DoorOverlay {
  /** The last frame of doors the game sent; the one drawn on the canvas now (the next animation frame draws the last), and how many doors of it are. */
  readonly frame: OverlayFrame | undefined;
  readonly drawnFrame: OverlayFrame | undefined;
  readonly drawn: number;
  /** How many frames of doors have been taken, and drawn. */
  readonly received: number;
  readonly draws: number;
  /** How many of the frame's lamp posts are drawn (web/page/lamps.ts). */
  readonly lampsDrawn: number;
  readonly canvas: HTMLCanvasElement;
  /** Device pixels a cell, as last drawn. */
  readonly cell: { width: number; height: number; dpr: number } | undefined;
}

const FIREFOX = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);

export function doorOverlay(term: Term): DoorOverlay | undefined {
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) return undefined;
  const canvas = document.createElement("canvas");
  canvas.className = "km-doors";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", zIndex: "1", pointerEvents: "none" });
  screen.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  let frame: OverlayFrame | undefined, drawnFrame: OverlayFrame | undefined;
  let drawn = 0, received = 0, draws = 0;
  let lampsDrawn = 0;
  let dims: Dimensions | undefined;
  let scheduled = 0;

  const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(draw); };

  // The game's doors come just before the frame they belong to, which xterm draws all at once when
  // it has parsed its end (the end of its synchronized output, CSI ? 2026 l): they're taken then, so
  // xterm's next drawing and this one show them together. A frame with nothing new to draw has no
  // such end: its doors are taken a moment later.
  let waiting: OverlayFrame | undefined;
  let late: ReturnType<typeof setTimeout> | undefined;
  const take = () => {
    clearTimeout(late);
    if (!waiting) return;
    frame = waiting;
    waiting = undefined;
    schedule();
  };
  term.parser.registerOscHandler(OVERLAY_OSC, data => {
    try {
      const said = JSON.parse(data) as OverlayFrame;
      if (Array.isArray(said?.doors)) {
        waiting = said;
        received++;
        clearTimeout(late);
        late = setTimeout(take, 250);
      }
    } catch {
      // Not ours, or cut short: the next one will do.
    }
    return true;
  });
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, params => {
    if (waiting && params.some(p => p === 2026 || (Array.isArray(p) && p[0] === 2026))) take();
    // xterm's own handling of it goes on.
    return false;
  });
  // The game leaving its screen (it closed, or is starting again): its doors go with it.
  term.buffer.onBufferChange(() => { frame = undefined; waiting = undefined; schedule(); });
  // A new size: the doors' cells mean nothing until the game has drawn at it, so they wait for it.
  term.onResize(schedule);
  term.onSelectionChange(schedule);
  // The cells' size can change without the terminal's (a zoom, a font): xterm re-renders, and the doors follow.
  term.onRender(() => { if (!dims || changed(dims, measure())) schedule(); });
  new ResizeObserver(schedule).observe(screen);
  let ratio = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  const watchRatio = () => {
    ratio.removeEventListener("change", watchRatio);
    ratio = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    ratio.addEventListener("change", watchRatio);
    schedule();
  };
  ratio.addEventListener("change", watchRatio);

  /** xterm's cells, in device pixels, and its canvas's size: the render service's, else what the screen's box says. */
  function measure(): Dimensions {
    const core = (term as unknown as { _core?: { _renderService?: { dimensions?: { device: { cell: { width: number; height: number }; canvas: { width: number; height: number } }; css: { canvas: { width: number; height: number } } } } } })._core;
    const d = core?._renderService?.dimensions;
    const dpr = devicePixelRatio || 1;
    if (d && d.device.cell.width > 0 && d.device.cell.height > 0) {
      return { cols: term.cols, rows: term.rows, cellW: d.device.cell.width, cellH: d.device.cell.height, width: d.device.canvas.width, height: d.device.canvas.height, cssWidth: d.css.canvas.width, cssHeight: d.css.canvas.height, dpr };
    }
    const box = screen!.getBoundingClientRect();
    const cellW = Math.max(1, Math.round((box.width / term.cols) * dpr)), cellH = Math.max(1, Math.round((box.height / term.rows) * dpr));
    return { cols: term.cols, rows: term.rows, cellW, cellH, width: cellW * term.cols, height: cellH * term.rows, cssWidth: box.width, cssHeight: box.height, dpr };
  }

  function draw(): void {
    scheduled = 0;
    dims = measure();
    if (canvas.width !== dims.width || canvas.height !== dims.height) { canvas.width = dims.width; canvas.height = dims.height; }
    canvas.style.width = `${dims.cssWidth}px`;
    canvas.style.height = `${dims.cssHeight}px`;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    drawn = 0;
    draws++;
    drawnFrame = undefined;
    lampsDrawn = 0;
    if (!frame || frame.cols !== term.cols || frame.rows !== term.rows || term.hasSelection()) return;
    drawnFrame = frame;
    for (const door of frame.doors) if (drawDoor(door, dims)) drawn++;
    // The lamp posts, after the doors, on the same cells (web/page/lamps.ts).
    lampsDrawn = drawLamps(ctx!, frame, dims);
  }

  /** A door: the wall it took given back (glyphs and all, as xterm draws them), then its picture's pixels. */
  function drawDoor(door: DoorShape, d: Dimensions): boolean {
    const painted = paintDoor(door);
    if (!painted.pixels.length) return false;
    for (const cell of painted.wall) drawCell(cell, d);
    // An art pixel's device pixels: its cell's, cut in sevenths across and fifteenths down.
    const xs = (X: number) => { const c = Math.floor(X / AX); return c * d.cellW + Math.floor(((X - c * AX) * d.cellW) / AX); };
    const ys = (Y: number) => { const r = Math.floor(Y / AY); return r * d.cellH + Math.floor(((Y - r * AY) * d.cellH) / AY); };
    const byColour = new Map<string, Path2D>();
    for (const { X, Y, c } of painted.pixels) {
      const x0 = xs(X), x1 = xs(X + 1), y0 = ys(Y), y1 = ys(Y + 1);
      if (x1 <= x0 || y1 <= y0) continue;
      const colour = toHex(c);
      let path = byColour.get(colour);
      if (!path) { path = new Path2D(); byColour.set(colour, path); }
      path.rect(x0, y0, x1 - x0, y1 - y0);
    }
    for (const [colour, path] of byColour) { ctx!.fillStyle = colour; ctx!.fill(path); }
    return true;
  }

  /** A cell of wall, as xterm draws one: its background, then its glyph (block and box characters drawn as xterm draws them). */
  function drawCell([x, y, ch, fg, bg]: WallCell, d: Dimensions): void {
    const px = x * d.cellW, py = y * d.cellH;
    ctx!.fillStyle = bg;
    ctx!.fillRect(px, py, d.cellW, d.cellH);
    if (ch === " " || !ch) return;
    ctx!.save();
    ctx!.beginPath();
    ctx!.rect(px, py, d.cellW, d.cellH);
    ctx!.clip();
    ctx!.fillStyle = fg;
    if (!customGlyph(ch, px, py, d)) {
      ctx!.font = `${(term.options.fontSize ?? 15) * d.dpr}px ${term.options.fontFamily ?? "monospace"}`;
      ctx!.textBaseline = FIREFOX ? "bottom" : "ideographic";
      ctx!.fillText(ch, px, py + d.cellH);
    }
    ctx!.restore();
  }

  /** Block elements, shades and light box lines, as xterm.js's WebGL renderer draws them itself (its CustomGlyphs.ts, MIT). */
  function customGlyph(ch: string, x: number, y: number, d: Dimensions): boolean {
    const w = d.cellW, h = d.cellH;
    const block = BLOCKS[ch];
    if (block) {
      for (const [bx, by, bw, bh] of block) ctx!.fillRect(x + (bx * w) / 8, y + (by * h) / 8, (bw * w) / 8, (bh * h) / 8);
      return true;
    }
    const pattern = PATTERNS[ch];
    if (pattern) {
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) if (pattern[py % pattern.length]![px % pattern[0]!.length]) ctx!.fillRect(x + px, y + py, 1, 1);
      return true;
    }
    const lines = BOX[ch];
    if (lines) {
      ctx!.strokeStyle = ctx!.fillStyle;
      ctx!.lineWidth = d.dpr;
      ctx!.beginPath();
      const at = (v: number, size: number) => (v === 0 ? 0 : Math.min(size, Math.max(0, Math.round(v * size + 0.5) - 0.5)));
      for (const [x0, y0, x1, y1] of lines) { ctx!.moveTo(x + at(x0, w), y + at(y0, h)); ctx!.lineTo(x + at(x1, w), y + at(y1, h)); }
      ctx!.stroke();
      return true;
    }
    return false;
  }

  return {
    get frame() { return frame; },
    get drawnFrame() { return drawnFrame; },
    get drawn() { return drawn; },
    get received() { return received; },
    get draws() { return draws; },
    get lampsDrawn() { return lampsDrawn; },
    canvas,
    get cell() { return dims ? { width: dims.cellW, height: dims.cellH, dpr: dims.dpr } : undefined; },
  };
}

const changed = (a: Dimensions, b: Dimensions) => a.cellW !== b.cellW || a.cellH !== b.cellH || a.width !== b.width || a.height !== b.height || a.dpr !== b.dpr;

/** Block elements: [x, y, w, h] in eighths of a cell. */
const BLOCKS: Record<string, Array<[number, number, number, number]>> = {
  "▀": [[0, 0, 8, 4]], "▁": [[0, 7, 8, 1]], "▂": [[0, 6, 8, 2]], "▃": [[0, 5, 8, 3]], "▄": [[0, 4, 8, 4]], "▅": [[0, 3, 8, 5]], "▆": [[0, 2, 8, 6]], "▇": [[0, 1, 8, 7]],
  "█": [[0, 0, 8, 8]], "▉": [[0, 0, 7, 8]], "▊": [[0, 0, 6, 8]], "▋": [[0, 0, 5, 8]], "▌": [[0, 0, 4, 8]], "▍": [[0, 0, 3, 8]], "▎": [[0, 0, 2, 8]], "▏": [[0, 0, 1, 8]],
  "▐": [[4, 0, 4, 8]], "▔": [[0, 0, 8, 1]], "▕": [[7, 0, 1, 8]],
  "▖": [[0, 4, 4, 4]], "▗": [[4, 4, 4, 4]], "▘": [[0, 0, 4, 4]], "▝": [[4, 0, 4, 4]],
  "▙": [[0, 0, 4, 8], [0, 4, 8, 4]], "▚": [[0, 0, 4, 4], [4, 4, 4, 4]], "▛": [[0, 0, 4, 8], [4, 0, 4, 4]], "▜": [[0, 0, 8, 4], [4, 0, 4, 8]], "▞": [[4, 0, 4, 4], [0, 4, 4, 4]], "▟": [[4, 0, 4, 8], [0, 4, 8, 4]],
};

/** Shades: a repeating pattern of device pixels. */
const PATTERNS: Record<string, number[][]> = {
  "░": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
  "▒": [[1, 0], [0, 0], [0, 1], [0, 0]],
  "▓": [[0, 1], [1, 1], [1, 0], [1, 1]],
};

/** Light box lines: segments [x0, y0, x1, y1] across the cell, from 0 to 1. */
const BOX: Record<string, Array<[number, number, number, number]>> = {
  "─": [[0, 0.5, 1, 0.5]], "│": [[0.5, 0, 0.5, 1]], "┼": [[0, 0.5, 1, 0.5], [0.5, 0, 0.5, 1]],
  "╷": [[0.5, 0.5, 0.5, 1]], "╵": [[0.5, 0.5, 0.5, 0]], "╴": [[0.5, 0.5, 0, 0.5]], "╶": [[0.5, 0.5, 1, 0.5]],
  "┌": [[0.5, 1, 0.5, 0.5], [0.5, 0.5, 1, 0.5]], "┐": [[0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 1]], "└": [[0.5, 0, 0.5, 0.5], [0.5, 0.5, 1, 0.5]], "┘": [[0.5, 0, 0.5, 0.5], [0.5, 0.5, 0, 0.5]],
  "├": [[0.5, 0, 0.5, 1], [0.5, 0.5, 1, 0.5]], "┤": [[0.5, 0, 0.5, 1], [0.5, 0.5, 0, 0.5]], "┬": [[0, 0.5, 1, 0.5], [0.5, 0.5, 0.5, 1]], "┴": [[0, 0.5, 1, 0.5], [0.5, 0.5, 0.5, 0]],
};
