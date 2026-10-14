import { RGBA, Renderable, TextAttributes, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core";
import { extend } from "@opentui/react";
import type { StyledLine } from "../types.ts";
import { BOLD, Canvas } from "./canvas.ts";
import { rgbOf } from "./color.ts";

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
 * (the game moved on) is asked straight away. `live={false}` holds the picture still.
 */

export type Painter = (w: number, h: number, now: number) => Canvas | StyledLine[];

export interface LookCanvasOptions extends RenderableOptions<LookCanvasRenderable> {
  painter?: Painter;
  /** Ask for a new frame at most this many times a second (default: every time OpenTUI draws). */
  fps?: number;
}

export class LookCanvasRenderable extends Renderable {
  private _painter: Painter | undefined;
  private _fps: number | undefined;
  private last: { frame: Canvas | StyledLine[]; at: number; w: number; h: number } | undefined;
  private colors = new Map<number, RGBA>();
  private hexes = new Map<string, RGBA>();
  /** Milliseconds the last frame took to paint (for a frame-rate readout). */
  lastPaintMs = 0;

  constructor(ctx: RenderContext, options: LookCanvasOptions) {
    super(ctx, { ...options, live: options.live ?? true });
    this._painter = options.painter;
    this._fps = options.fps;
  }

  set painter(p: Painter | undefined) { this._painter = p; this.last = undefined; this.requestRender(); }
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

  private hex(h: string): RGBA {
    let v = this.hexes.get(h);
    if (!v) {
      if (this.hexes.size > 20_000) this.hexes.clear();
      v = this.rgba(rgbOf(h));
      this.hexes.set(h, v);
    }
    return v;
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const p = this._painter;
    const w = Math.max(1, Math.floor(this.width)), h = Math.max(1, Math.floor(this.height));
    if (!p) return;
    const now = performance.now();
    const last = this.last;
    if (!last || last.w !== w || last.h !== h || !this._fps || now - last.at >= 1000 / this._fps - 2) {
      this.last = { frame: p(w, h, now), at: now, w, h };
      this.lastPaintMs = performance.now() - now;
    }
    const frame = this.last!.frame;
    if (frame instanceof Canvas) {
      for (let y = 0; y < Math.min(h, frame.h); y++) for (let x = 0; x < Math.min(w, frame.w); x++) {
        const i = y * frame.w + x;
        buffer.setCell(this.x + x, this.y + y, frame.glyph[i]!, this.rgba(frame.fg[i]!), this.rgba(frame.bg[i]!), (frame.flags[i]! & BOLD) ? TextAttributes.BOLD : 0);
      }
      return;
    }
    // Styled lines: a run at a time; a run with no colours leaves what's behind it.
    const plain = this.hex("#ddd5c4");
    for (let y = 0; y < Math.min(h, frame.length); y++) {
      let x = 0;
      for (const span of frame[y]!) {
        if (x >= w) break;
        const chars = [...span.text];
        const text = x + chars.length > w ? chars.slice(0, w - x).join("") : span.text;
        buffer.drawText(text, this.x + x, this.y + y, span.fg ? this.hex(span.fg) : plain, span.bg ? this.hex(span.bg) : undefined, span.bold ? TextAttributes.BOLD : 0);
        x += chars.length;
      }
    }
  }
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
