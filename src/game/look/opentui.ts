import { RGBA, Renderable, TextAttributes, type CliRenderer, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core";
import { extend } from "@opentui/react";
import type { StyledLine } from "../types.ts";
import { BOLD, Canvas } from "./canvas.ts";
import { rgbOf } from "./color.ts";
import type { DoorShape, OverlayFrame } from "./door-art.ts";
import { moveDoor, overlaySequence, wantOverlay } from "./overlay.ts";

/**
 * The look layer in OpenTUI: a live renderable that paints frames straight into the screen buffer.
 * React doesn't re-render for animation: the renderable is "live", so OpenTUI redraws it at the
 * renderer's frame rate and asks the painter for the frame at that instant. OpenTUI diffs cells
 * natively and wraps each frame in synchronized output (DEC 2026), so redraws don't flicker.
 *
 *   registerLookCanvas();                       // once, before rendering
 *   <lookCanvas width={w} height={h} painter={(w, h, now) => player.frame(now - t0, { w, h, glyphs })} />
 *
 * A painter returns a Canvas (the stage, the gallery) or styled lines (the map's renderer). With
 * `fps`, a new frame is asked for at most that often and the last one is drawn in between, so the
 * world animates at its own pace while the rest of the screen keeps the renderer's; a new painter
 * (the game moved on) is asked straight away. `live={false}` holds the picture still (whatever
 * else on screen keeps OpenTUI drawing). A cell that keeps its glyph and moves by a shade nobody
 * can see (lamplight's flicker) is drawn as it was, so the terminal isn't sent it every frame.
 *
 * In the browser builds, a painter can also say where the frame's doors are ({ frame, doors }:
 * src/game/look/overlay.ts), for attachOverlay (below) to send the page, which draws them as pictures.
 */

/** A frame, and (in the browser builds) its doors, in the frame's own cells. */
export type Painted = Canvas | StyledLine[] | { frame: Canvas | StyledLine[]; doors?: DoorShape[] };
export type Painter = (w: number, h: number, now: number) => Painted;

/** The canvases on screen, for the overlay to ask where their doors are. */
const canvases = new Set<LookCanvasRenderable>();

export interface LookCanvasOptions extends RenderableOptions<LookCanvasRenderable> {
  painter?: Painter;
  /** Ask for a new frame at most this many times a second (default: every time OpenTUI draws). */
  fps?: number;
}

/** A frame as cells: glyph ("" where styled lines don't reach), colours packed (-1: none), bold. */
interface Cells { w: number; h: number; glyph: string[]; fg: Int32Array; bg: Int32Array; bold: Uint8Array; canvas: boolean }

/** How far a cell's colours may drift (per channel, of 255) and still be drawn as they were. */
const DEAD_BAND = 4;
const near = (a: number, b: number) => a === b || (a >= 0 && b >= 0 && Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) <= DEAD_BAND && Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) <= DEAD_BAND && Math.abs((a & 255) - (b & 255)) <= DEAD_BAND);

export class LookCanvasRenderable extends Renderable {
  private _painter: Painter | undefined;
  private _fps: number | undefined;
  private last: { cells: Cells; at: number; w: number; h: number } | undefined;
  /** A new painter: ask it straight away. */
  private fresh = false;
  private colors = new Map<number, RGBA>();
  /** The last frame's doors, in the frame's own cells (the browser builds' overlay). */
  private doors: DoorShape[] | undefined;
  /** Milliseconds the last frame took to paint (for a frame-rate readout). */
  lastPaintMs = 0;

  constructor(ctx: RenderContext, options: LookCanvasOptions) {
    super(ctx, { ...options, live: options.live ?? true });
    this._painter = options.painter;
    this._fps = options.fps;
    canvases.add(this);
  }

  protected override destroySelf(): void {
    canvases.delete(this);
    super.destroySelf();
  }

  /**
   * The last frame's doors on the screen: moved from the frame's cells to the screen's, each keeping
   * only the cells that show this canvas's own drawing in the frame about to go out (`shows`):
   * whatever's drawn over the canvas (a menu, a card, the sheet) hides a door there.
   */
  doorsOnScreen(shows: (x: number, y: number, glyph: string, fg: number, bg: number) => boolean): DoorShape[] {
    const last = this.last;
    if (!this.doors?.length || !last || this.isDestroyed || !this.visible) return [];
    const { cells } = last, ox = Math.trunc(this.x), oy = Math.trunc(this.y);
    const keep = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= cells.w || y >= cells.h) return false;
      const i = y * cells.w + x, glyph = cells.glyph[i]!;
      return !!glyph && shows(ox + x, oy + y, glyph, cells.fg[i]!, cells.bg[i]!);
    };
    return this.doors.flatMap(d => moveDoor(d, ox, oy, keep) ?? []);
  }

  set painter(p: Painter | undefined) { this._painter = p; this.fresh = true; this.requestRender(); }
  get painter(): Painter | undefined { return this._painter; }
  set fps(fps: number | undefined) { this._fps = fps; }
  get fps(): number | undefined { return this._fps; }

  private rgba(c: number): RGBA {
    let v = this.colors.get(c);
    if (!v) {
      if (this.colors.size > 20_000) this.colors.clear();
      v = RGBA.fromInts((c >> 16) & 255, (c >> 8) & 255, c & 255, 255);
      this.colors.set(c, v);
    }
    return v;
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const p = this._painter;
    const w = Math.max(1, Math.floor(this.width)), h = Math.max(1, Math.floor(this.height));
    if (!p) return;
    const now = performance.now();
    const last = this.last;
    // A new frame for a new painter or a new size, or (live) when it's due; held still, the last one stands.
    if (this.fresh || !last || last.w !== w || last.h !== h || (this.live && (!this._fps || now - last.at >= 1000 / this._fps - 2))) {
      this.fresh = false;
      const painted = p(w, h, now);
      const frame = painted instanceof Canvas || Array.isArray(painted) ? painted : painted.frame;
      this.doors = painted instanceof Canvas || Array.isArray(painted) ? undefined : painted.doors;
      const cells = cellsOf(frame, w, h);
      // What hasn't visibly changed is drawn as it was.
      const was = last?.cells;
      if (was && was.w === cells.w && was.h === cells.h && was.canvas === cells.canvas) {
        for (let i = 0; i < cells.glyph.length; i++) {
          if (cells.glyph[i] !== was.glyph[i] || !near(cells.fg[i]!, was.fg[i]!) || !near(cells.bg[i]!, was.bg[i]!)) continue;
          cells.fg[i] = was.fg[i]!; cells.bg[i] = was.bg[i]!;
        }
      }
      this.last = { cells, at: now, w, h };
      this.lastPaintMs = performance.now() - now;
    }
    const { cells } = this.last!;
    if (cells.canvas) {
      for (let y = 0; y < cells.h; y++) for (let x = 0; x < cells.w; x++) {
        const i = y * cells.w + x;
        buffer.setCell(this.x + x, this.y + y, cells.glyph[i]!, this.rgba(cells.fg[i]!), this.rgba(cells.bg[i]!), cells.bold[i] ? TextAttributes.BOLD : 0);
      }
      return;
    }
    // Styled lines: a run of one style at a time; a run with no background leaves what's behind it.
    const same = (a: number, b: number) => !!cells.glyph[b] && cells.fg[b] === cells.fg[a] && cells.bg[b] === cells.bg[a] && cells.bold[b] === cells.bold[a];
    for (let y = 0; y < cells.h; y++) {
      for (let x = 0; x < cells.w;) {
        const i = y * cells.w + x;
        if (!cells.glyph[i]) { x++; continue; }
        let n = 1;
        while (x + n < cells.w && same(i, i + n)) n++;
        buffer.drawText(cells.glyph.slice(i, i + n).join(""), this.x + x, this.y + y, this.rgba(cells.fg[i]!), cells.bg[i]! >= 0 ? this.rgba(cells.bg[i]!) : undefined, cells.bold[i] ? TextAttributes.BOLD : 0);
        x += n;
      }
    }
  }
}

/** Text with no colour of its own (styled lines without one). */
const PLAIN = rgbOf("#ddd5c4");

/** A painter's frame as cells, clipped to the canvas: styled lines leave nothing where they don't reach. */
function cellsOf(frame: Canvas | StyledLine[], w: number, h: number): Cells {
  const canvas = frame instanceof Canvas;
  const cw = canvas ? Math.min(w, frame.w) : w, ch = canvas ? Math.min(h, frame.h) : h;
  const out: Cells = { w: cw, h: ch, glyph: new Array<string>(cw * ch).fill(""), fg: new Int32Array(cw * ch).fill(-1), bg: new Int32Array(cw * ch).fill(-1), bold: new Uint8Array(cw * ch), canvas };
  if (frame instanceof Canvas) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x, j = y * frame.w + x;
      out.glyph[i] = frame.glyph[j]!; out.fg[i] = frame.fg[j]!; out.bg[i] = frame.bg[j]!; out.bold[i] = frame.flags[j]! & BOLD ? 1 : 0;
    }
    return out;
  }
  for (let y = 0; y < Math.min(ch, frame.length); y++) {
    let x = 0;
    for (const span of frame[y]!) {
      const fg = span.fg ? rgbOf(span.fg) : PLAIN, bg = span.bg ? rgbOf(span.bg) : -1, bold = span.bold ? 1 : 0;
      for (const c of span.text) {
        if (x >= cw) break;
        const i = y * cw + x++;
        out.glyph[i] = c; out.fg[i] = fg; out.bg[i] = bg; out.bold[i] = bold;
      }
    }
  }
  return out;
}

declare module "@opentui/react" {
  interface OpenTUIComponents {
    lookCanvas: typeof LookCanvasRenderable;
  }
}

let registered = false;
/** Make <lookCanvas> available to OpenTUI's React renderer. */
export function registerLookCanvas(): void {
  if (registered) return;
  extend({ lookCanvas: LookCanvasRenderable });
  registered = true;
}

// ---------------------------------------------------------------------------------------------
// The browser's overlay: the doors drawn as pictures over the ASCII (src/web/page/doors.ts)

/** What the frame about to go out shows in a cell: its character's code point (-1: can't tell), and its colours (0xrrggbb). */
type Shown = (x: number, y: number) => { ch: number; fg: number; bg: number } | undefined;

/** A frame's cells, in a post-process step: OpenTUI's native buffer's planes, or src/web/tui's arrays. */
function shownIn(buffer: OptimizedBuffer): Shown {
  const width = buffer.width, height = buffer.height;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const tui = buffer as unknown as { chars?: string[]; fg?: unknown; bg?: unknown };
  if (Array.isArray(tui.chars) && tui.fg instanceof Uint32Array && tui.bg instanceof Uint32Array) {
    // src/web/tui: a string a cell, colours packed 0xRRGGBBAA.
    const chars = tui.chars, fg = tui.fg, bg = tui.bg;
    return (x, y) => { if (!inside(x, y)) return undefined; const i = y * width + x; return { ch: chars[i]?.codePointAt(0) ?? -1, fg: fg[i]! >>> 8, bg: bg[i]! >>> 8 }; };
  }
  // OpenTUI's own: a code point a cell (or the id of a longer grapheme), colours as four 16-bit channels, the value in the low byte.
  const { char, fg, bg } = buffer.buffers;
  const rgb = (p: Uint16Array, k: number) => ((p[k]! & 255) << 16) | ((p[k + 1]! & 255) << 8) | (p[k + 2]! & 255);
  return (x, y) => {
    if (!inside(x, y)) return undefined;
    const i = y * width + x, c = char[i]!;
    return { ch: c < 0x110000 ? c : -1, fg: rgb(fg, i * 4), bg: rgb(bg, i * 4) };
  };
}

/** Whether a cell still shows what a canvas drew there (its glyph; its colours, where it gave them). */
function same(s: ReturnType<Shown>, glyph: string, fg: number, bg: number): boolean {
  if (!s) return false;
  const cp = glyph.codePointAt(0) ?? -1;
  return !(s.ch >= 0 && cp >= 0 && s.ch !== cp) && !(fg >= 0 && s.fg !== (fg & 0xffffff)) && !(bg >= 0 && s.bg !== (bg & 0xffffff));
}

/**
 * Bytes to the terminal just before the frame about to go out, in order with it: through OpenTUI's
 * native session (its ordered output, where frames go), or src/web/tui's terminal.
 */
function beforeFrame(renderer: CliRenderer, data: string): boolean {
  const r = renderer as unknown as { writeRaw?: (data: string) => boolean; nativeSession?: { write?: (bytes: Uint8Array) => boolean } };
  try {
    if (typeof r.writeRaw === "function") return r.writeRaw(data);
    if (typeof r.nativeSession?.write === "function") return r.nativeSession.write(new TextEncoder().encode(data));
  } catch {
    // The terminal's going (or full): the next frame tries again.
  }
  return false;
}

/**
 * In the browser builds (KM_IN_BROWSER), tell the page where the doors are, so it can draw them as
 * pictures over the ASCII: with each frame that changes them, an OSC sequence it listens for
 * (overlaySequence), just before the frame's own bytes. The page holds it until xterm has parsed the
 * frame after it (the end of its synchronized output, which xterm draws all at once), so the doors
 * and the cells under them show together: a door is never a frame out of place.
 * Each live view says where its doors are (overlayWanted: src/app/ui), and a door keeps only the
 * cells that show its view's drawing in the frame going out, so whatever's drawn over the view (a
 * menu, a card, the sheet) hides it there. The terminal game draws its ASCII alone: no sequence,
 * nothing extra worked out.
 */
export function attachOverlay(renderer: CliRenderer): boolean {
  if (!process.env.KM_IN_BROWSER || process.env.KM_DOORS === "off" || typeof renderer.addPostProcessFn !== "function") return false;
  wantOverlay(true);
  let sent = "";
  renderer.addPostProcessFn(buffer => {
    let shown: Shown;
    try { shown = shownIn(buffer); } catch { return; }
    const doors: DoorShape[] = [];
    for (const canvas of canvases) {
      if (canvas.isDestroyed) { canvases.delete(canvas); continue; }
      doors.push(...canvas.doorsOnScreen((x, y, glyph, fg, bg) => same(shown(x, y), glyph, fg, bg)));
    }
    const frame: OverlayFrame = { cols: renderer.width, rows: renderer.height, doors };
    const message = overlaySequence(frame);
    if (message !== sent && beforeFrame(renderer, message)) sent = message;
  });
  return true;
}
