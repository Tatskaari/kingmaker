import type { Span, StyledLine } from "../types.ts";
import { hexOf, mix, rgbOf, type RGB } from "./color.ts";

/**
 * A frame: a grid of cells (glyph, fg, bg, flags), composed back to front and then lit. Colours
 * are packed numbers for speed; out come StyledLines (the shared contract), ANSI for a terminal
 * dump, or plain text for tests.
 */

/** Cell flags: BOLD text; GLOW emissive (not darkened); BEING and WALL get a light floor (people and a room's outline stay findable in the dark); UNLIT text drawn after lighting. */
export const BOLD = 1, GLOW = 2, BEING = 4, UNLIT = 8, ITALIC = 16, WALL = 32;
export const INK = rgbOf("#0e0d12");

export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly glyph: string[];
  readonly fg: Int32Array;
  readonly bg: Int32Array;
  readonly flags: Uint8Array;
  /** Glints that take the light's colour (water, wet stone). */
  readonly spec: Float32Array;

  constructor(w: number, h: number, bg: RGB = INK) {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    const n = this.w * this.h;
    this.glyph = new Array<string>(n).fill(" ");
    this.fg = new Int32Array(n).fill(bg);
    this.bg = new Int32Array(n).fill(bg);
    this.flags = new Uint8Array(n);
    this.spec = new Float32Array(n);
  }

  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  index(x: number, y: number): number { return y * this.w + x; }

  /** Put a cell (bg left alone when undefined, so things can lie on tables and rugs). */
  put(x: number, y: number, glyph: string, fg: RGB, bg?: RGB, flags = 0): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.glyph[i] = glyph;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
    this.flags[i] = flags;
    this.spec[i] = 0;
  }

  /** Lay a colour over a cell's background (smoke, a flash, a stain): k = 0..1. */
  tint(x: number, y: number, color: RGB, k: number, fgToo = 0): void {
    if (!this.inside(x, y) || k <= 0) return;
    const i = y * this.w + x;
    this.bg[i] = mix(this.bg[i]!, color, Math.min(1, k));
    if (fgToo > 0) this.fg[i] = mix(this.fg[i]!, color, Math.min(1, fgToo));
  }

  /** Text on the grid (floating text, captions): one cell a character. */
  text(x: number, y: number, text: string, fg: RGB, bg?: RGB, flags = UNLIT): void {
    let cx = x;
    for (const ch of text) { this.put(cx, y, ch, fg, bg, flags); cx++; }
  }

  /** The frame as StyledLines (runs of equal style merged). */
  toLines(): StyledLine[] {
    const lines: StyledLine[] = [];
    for (let y = 0; y < this.h; y++) {
      const spans: Span[] = [];
      let run = "", fg = -1, bg = -1, bold = false;
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const f = this.fg[i]!, b = this.bg[i]!, bo = (this.flags[i]! & BOLD) !== 0;
        if (run && (f !== fg || b !== bg || bo !== bold)) { spans.push({ text: run, fg: hexOf(fg), bg: hexOf(bg), ...(bold ? { bold: true } : {}) }); run = ""; }
        if (!run) { fg = f; bg = b; bold = bo; }
        run += this.glyph[i]!;
      }
      if (run) spans.push({ text: run, fg: hexOf(fg), bg: hexOf(bg), ...(bold ? { bold: true } : {}) });
      lines.push(spans);
    }
    return lines;
  }

  /** 24-bit ANSI, for a terminal dump. */
  toAnsi(): string {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let line = "", last = "";
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const f = this.fg[i]!, b = this.bg[i]!;
        const sgr = `${(this.flags[i]! & BOLD) ? "1;" : "22;"}38;2;${(f >> 16) & 255};${(f >> 8) & 255};${f & 255};48;2;${(b >> 16) & 255};${(b >> 8) & 255};${b & 255}`;
        if (sgr !== last) { line += `\x1b[${sgr}m`; last = sgr; }
        line += this.glyph[i]!;
      }
      out.push(`${line}\x1b[0m`);
    }
    return out.join("\n");
  }

  /** Every cell as [glyph, fg, bg, bold]: for tools that rasterize frames (previews, diffs). */
  toJSON(): { w: number; h: number; cells: Array<[string, string, string, boolean]> } {
    const cells: Array<[string, string, string, boolean]> = [];
    for (let i = 0; i < this.w * this.h; i++) cells.push([this.glyph[i]!, hexOf(this.fg[i]!), hexOf(this.bg[i]!), (this.flags[i]! & BOLD) !== 0]);
    return { w: this.w, h: this.h, cells };
  }

  /** Just the characters. */
  toPlain(): string {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.glyph.slice(y * this.w, (y + 1) * this.w).join("").replace(/\s+$/, ""));
    return out.join("\n");
  }
}
