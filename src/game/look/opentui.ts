import { RGBA, Renderable, TextAttributes, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core";
import { extend } from "@opentui/react";
import { BOLD, type Canvas } from "./canvas.ts";

/**
 * The look layer in OpenTUI: a live renderable that paints a frame (a Canvas) straight into the
 * screen buffer every frame. React doesn't re-render for animation: the renderable is "live", so
 * OpenTUI redraws it at the renderer's frame rate and asks the painter for the frame at that
 * instant. OpenTUI diffs cells natively and wraps each frame in synchronized output (DEC 2026), so
 * redraws don't flicker.
 *
 *   registerLookCanvas();                       // once, before rendering
 *   <lookCanvas width={w} height={h} painter={(w, h, now) => player.frame(now - t0, { w, h, glyphs })} />
 */

export type Painter = (w: number, h: number, now: number) => Canvas;

export interface LookCanvasOptions extends RenderableOptions<LookCanvasRenderable> {
  painter?: Painter;
}

export class LookCanvasRenderable extends Renderable {
  private _painter: Painter | undefined;
  private colors = new Map<number, RGBA>();
  /** Milliseconds the last frame took to paint (for a frame-rate readout). */
  lastPaintMs = 0;

  constructor(ctx: RenderContext, options: LookCanvasOptions) {
    super(ctx, { ...options, live: true });
    this._painter = options.painter;
  }

  set painter(p: Painter | undefined) { this._painter = p; this.requestRender(); }
  get painter(): Painter | undefined { return this._painter; }

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
    const started = performance.now();
    const frame = p(w, h, started);
    for (let y = 0; y < Math.min(h, frame.h); y++) for (let x = 0; x < Math.min(w, frame.w); x++) {
      const i = y * frame.w + x;
      buffer.setCell(this.x + x, this.y + y, frame.glyph[i]!, this.rgba(frame.fg[i]!), this.rgba(frame.bg[i]!), (frame.flags[i]! & BOLD) ? TextAttributes.BOLD : 0);
    }
    this.lastPaintMs = performance.now() - started;
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
