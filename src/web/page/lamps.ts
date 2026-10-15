import { AX, AY, toHex } from "../../game/look/door-art.ts";
import { paintLamp, type LampFrame, type LampShape } from "../../game/look/lamp-art.ts";

/**
 * The lamp posts as pictures over the game's ASCII, in the page (src/web/README.md), drawn on the
 * doors' canvas after the doors (src/web/page/doors.ts calls drawLamps each time it draws: the same
 * frame of the game's, the same cells and device pixels), with the ASCII-plus spike's lamp
 * (src/game/look/lamp-art.ts):
 *
 *   - the cells the game drew the lamp's glyph and post in are taken back to the ground they were
 *     drawn on, flat, and the post and lantern drawn there, an art pixel a cell's 7th across and
 *     15th down, nearest-neighbour, so they're crisp at any font size and zoom;
 *   - a lit lamp's glow goes over them, added to what's drawn on this canvas there (as the spike
 *     added it to everything), laid over the ASCII elsewhere, and only on the cells the game said it
 *     may light: never anyone, nor what's nearer or drawn over the view;
 *   - ?lamps=off leaves the lamp posts to the ASCII (the doors are still drawn: for comparing the
 *     two); ?doors=off leaves both, and the game isn't asked for either.
 */

/** ?lamps=off: no lamp posts drawn. */
const OFF = typeof location !== "undefined" && new URLSearchParams(location.search).get("lamps") === "off";

/** Device pixels a cell, as the doors' canvas has them. */
export interface Cells { cellW: number; cellH: number }

/** Draws a frame's lamp posts on the doors' canvas; how many were drawn. */
export function drawLamps(ctx: CanvasRenderingContext2D, frame: LampFrame, d: Cells): number {
  if (OFF || !frame.lamps?.length) return 0;
  let drawn = 0;
  for (const lamp of frame.lamps) if (drawLamp(ctx, lamp, d)) drawn++;
  return drawn;
}

/** An art pixel's device pixel on each axis, as the doors' are: its cell's, cut in sevenths across and fifteenths down. */
const xs = (X: number, d: Cells) => { const c = Math.floor(X / AX); return c * d.cellW + Math.floor(((X - c * AX) * d.cellW) / AX); };
const ys = (Y: number, d: Cells) => { const r = Math.floor(Y / AY); return r * d.cellH + Math.floor(((Y - r * AY) * d.cellH) / AY); };

function drawLamp(ctx: CanvasRenderingContext2D, lamp: LampShape, d: Cells): boolean {
  const painted = paintLamp(lamp);
  if (!painted.pixels.length) return false;
  // The game's glyph and post, taken back to the ground.
  for (const [x, y, bg] of painted.ground) { ctx.fillStyle = bg; ctx.fillRect(x * d.cellW, y * d.cellH, d.cellW, d.cellH); }
  const byColour = new Map<string, Path2D>();
  for (const { X, Y, c } of painted.pixels) {
    const x0 = xs(X, d), x1 = xs(X + 1, d), y0 = ys(Y, d), y1 = ys(Y + 1, d);
    if (x1 <= x0 || y1 <= y0) continue;
    const colour = toHex(c);
    let path = byColour.get(colour);
    if (!path) { path = new Path2D(); byColour.set(colour, path); }
    path.rect(x0, y0, x1 - x0, y1 - y0);
  }
  for (const [colour, path] of byColour) { ctx.fillStyle = colour; ctx.fill(path); }
  const glow = painted.glow;
  if (glow?.cells.length) {
    // Soft light round the lantern, on its cells only: added to what's on this canvas (the lamp, the
    // ground under it), laid over the ASCII round it.
    const cx = (glow.X / AX) * d.cellW, cy = (glow.Y / AY) * d.cellH, r = glow.radius * d.cellW;
    const clip = new Path2D();
    for (const [x, y] of glow.cells) clip.rect(x * d.cellW, y * d.cellH, d.cellW, d.cellH);
    const [R, G, B] = [1, 3, 5].map(i => parseInt(glow.color.slice(i, i + 2), 16));
    const rgba = (a: number) => `rgba(${R},${G},${B},${a.toFixed(3)})`;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(glow.k));
    g.addColorStop(0.35, rgba(glow.k * 0.45));
    g.addColorStop(1, rgba(0));
    ctx.save();
    ctx.clip(clip);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
  }
  return true;
}
