import { RGBA, type ColorInput, parseColor } from "./rgba.ts";
import { clusters, codepointWidth, isPrintable, stringWidth } from "./width.ts";

/**
 * The cell buffer the screen is painted into, after OpenTUI's native OptimizedBuffer
 * (packages/native/src/buffer.zig): a character, a foreground and a background (packed RGBA,
 * 0xRRGGBBAA) and attributes per cell, with a stack of scissor rectangles. A wide character
 * takes its cell and a continuation cell after it (text ""); writing over either half clears the
 * other, as the native buffer does. Colours with alpha blend over what's beneath, and a space with
 * a see-through background leaves the glyph under it alone (blendCells).
 */

export interface ClipRect { x: number; y: number; width: number; height: number }

export const WHITE = 0xffffffff;
const alpha = (c: number) => c & 0xff;

const mulDiv255 = (a: number, b: number) => Math.floor((a * b + 127) / 255);
const roundDiv = (n: number, d: number) => Math.floor((n + Math.floor(d / 2)) / d);

/** Source over destination, in eight-bit channels (blendColors). */
export function blendColor(src: number, dst: number): number {
  const sa = alpha(src);
  if (sa === 0) return dst;
  if (sa === 255) return src >>> 0;
  const da = alpha(dst);
  const inv = 255 - sa;
  const outA = sa + mulDiv255(da, inv);
  if (outA === 0) return 0;
  const sr = (src >>> 24) & 255, sg = (src >>> 16) & 255, sb = (src >>> 8) & 255;
  const dr = (dst >>> 24) & 255, dg = (dst >>> 16) & 255, db = (dst >>> 8) & 255;
  if (da === 255) {
    return (((Math.floor((sr * sa + dr * inv + 127) / 255) << 24) | (Math.floor((sg * sa + dg * inv + 127) / 255) << 16) | (Math.floor((sb * sa + db * inv + 127) / 255) << 8) | 255) >>> 0);
  }
  return (((roundDiv(sr * sa + mulDiv255(dr * da, inv), outA) << 24) | (roundDiv(sg * sa + mulDiv255(dg * da, inv), outA) << 16) | (roundDiv(sb * sa + mulDiv255(db * da, inv), outA) << 8) | outA) >>> 0);
}

export type BorderStyle = "single" | "double" | "rounded" | "heavy";

/** topLeft, topRight, bottomLeft, bottomRight, horizontal, vertical (OpenTUI's border sets). */
export const BORDER_CHARS: Record<BorderStyle, readonly [string, string, string, string, string, string]> = {
  single: ["┌", "┐", "└", "┘", "─", "│"],
  double: ["╔", "╗", "╚", "╝", "═", "║"],
  rounded: ["╭", "╮", "╰", "╯", "─", "│"],
  heavy: ["┏", "┓", "┗", "┛", "━", "┃"],
};

export interface BorderSides { top: boolean; right: boolean; bottom: boolean; left: boolean }

export class OptimizedBuffer {
  width: number;
  height: number;
  /** Each cell's text: " " by default, "" for the second half of a wide character. */
  chars: string[] = [];
  /** 1 or 2 for a cell that starts a character, 0 for a continuation. */
  widths: Uint8Array = new Uint8Array(0);
  fg: Uint32Array = new Uint32Array(0);
  bg: Uint32Array = new Uint32Array(0);
  attrs: Uint32Array = new Uint32Array(0);
  readonly id: string;
  respectAlpha: boolean;
  private scissors: ClipRect[] = [];

  constructor(width: number, height: number, options: { respectAlpha?: boolean; id?: string } = {}) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.respectAlpha = options.respectAlpha ?? false;
    this.id = options.id ?? "buffer";
    this.allocate();
    this.clear();
  }

  static create(width: number, height: number, _widthMethod?: unknown, options: { respectAlpha?: boolean; id?: string } = {}): OptimizedBuffer {
    return new OptimizedBuffer(width, height, options);
  }

  private allocate(): void {
    const n = this.width * this.height;
    this.chars = new Array<string>(n);
    this.widths = new Uint8Array(n);
    this.fg = new Uint32Array(n);
    this.bg = new Uint32Array(n);
    this.attrs = new Uint32Array(n);
  }

  resize(width: number, height: number): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.allocate();
    this.clear();
  }

  destroy(): void { /* nothing native to free */ }

  clear(bg: number | RGBA = 0): void {
    const b = typeof bg === "number" ? bg : bg.packed;
    this.chars.fill(" ");
    this.widths.fill(1);
    this.fg.fill(WHITE);
    this.bg.fill(b);
    this.attrs.fill(0);
  }

  // ------------------------------------------------------------------------------------------
  // Scissors

  pushScissorRect(x: number, y: number, width: number, height: number): void {
    let rect: ClipRect = { x: Math.trunc(x), y: Math.trunc(y), width: Math.max(0, Math.trunc(width)), height: Math.max(0, Math.trunc(height)) };
    const top = this.scissors[this.scissors.length - 1];
    if (top) rect = intersect(rect, top) ?? { x: 0, y: 0, width: 0, height: 0 };
    this.scissors.push(rect);
  }

  popScissorRect(): void { this.scissors.pop(); }
  clearScissorRects(): void { this.scissors.length = 0; }
  get scissor(): ClipRect | undefined { return this.scissors[this.scissors.length - 1]; }

  isPointInScissor(x: number, y: number): boolean {
    const s = this.scissors[this.scissors.length - 1];
    return !s || (x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height);
  }

  private inBufferAndScissor(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.isPointInScissor(x, y);
  }

  private isRectInScissor(x: number, y: number, width: number, height: number): boolean {
    const s = this.scissors[this.scissors.length - 1];
    if (!s) return true;
    return !(x >= s.x + s.width || x + width <= s.x || y >= s.y + s.height || y + height <= s.y);
  }

  // ------------------------------------------------------------------------------------------
  // Cells

  /** Clear the wide character the cell at i belongs to (both halves become spaces, colours kept). */
  private breakSpan(i: number, rowStart: number, rowEnd: number): void {
    const w = this.widths[i]!;
    if (w === 2) {
      this.chars[i] = " "; this.widths[i] = 1; this.attrs[i] = 0;
      if (i + 1 <= rowEnd && this.widths[i + 1] === 0) { this.chars[i + 1] = " "; this.widths[i + 1] = 1; this.attrs[i + 1] = 0; }
    } else if (w === 0) {
      this.chars[i] = " "; this.widths[i] = 1; this.attrs[i] = 0;
      if (i - 1 >= rowStart && this.widths[i - 1] === 2) { this.chars[i - 1] = " "; this.widths[i - 1] = 1; this.attrs[i - 1] = 0; }
    }
  }

  /** Write a cell (native set(): span cleanup, and a wide character that doesn't fit blanks the rest of its row). Respects the scissor. */
  set(x: number, y: number, char: string, width: number, fg: number, bg: number, attrs: number): void {
    if (!this.inBufferAndScissor(x, y)) return;
    const rowStart = y * this.width, rowEnd = rowStart + this.width - 1, i = rowStart + x;
    if (this.widths[i] !== 1 && !(this.chars[i] === char && this.widths[i] === width)) this.breakSpan(i, rowStart, rowEnd);
    if (width === 2) {
      if (x + 2 > this.width) {
        for (let j = i; j <= rowEnd; j++) {
          if (this.widths[j] !== 1) this.breakSpan(j, rowStart, rowEnd);
          this.chars[j] = " "; this.widths[j] = 1; this.fg[j] = fg; this.bg[j] = bg; this.attrs[j] = attrs;
        }
        return;
      }
      if (this.widths[i + 1] !== 1) this.breakSpan(i + 1, rowStart, rowEnd);
      this.chars[i] = char; this.widths[i] = 2; this.fg[i] = fg; this.bg[i] = bg; this.attrs[i] = attrs;
      this.chars[i + 1] = ""; this.widths[i + 1] = 0; this.fg[i + 1] = fg; this.bg[i + 1] = bg; this.attrs[i + 1] = attrs;
      return;
    }
    this.chars[i] = char; this.widths[i] = 1; this.fg[i] = fg; this.bg[i] = bg; this.attrs[i] = attrs;
  }

  /** setCellWithAlphaBlending: opaque cells are set; otherwise they blend over what's there (blendCells). */
  blend(x: number, y: number, char: string, width: number, fg: number, bg: number, attrs: number): void {
    if (!this.inBufferAndScissor(x, y)) return;
    const fa = alpha(fg), ba = alpha(bg);
    if (fa === 0 && ba === 0) return;
    if (fa === 255 && ba === 255) { this.set(x, y, char, width, fg, bg, attrs); return; }
    const i = y * this.width + x;
    const blendedBg = ba < 255 ? blendColor(bg, this.bg[i]!) : bg;
    const destChar = this.chars[i]!;
    const preserve = char === " " && destChar !== "" && destChar !== " " && this.widths[i] === 1;
    if (preserve) {
      this.set(x, y, destChar, 1, blendColor(bg, this.fg[i]!), blendedBg, this.attrs[i]!);
      return;
    }
    this.set(x, y, char, width, fa < 255 ? blendColor(fg, blendedBg) : fg, blendedBg, attrs);
  }

  // ------------------------------------------------------------------------------------------
  // OpenTUI's JS buffer API (what renderables and the app's own renderables call)

  /** One code point in a cell, as OpenTUI's setCell: no blending; the first code point only. */
  setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes = 0): void {
    x = Math.trunc(x); y = Math.trunc(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const cp = char.codePointAt(0) ?? 32;
    const ch = cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? " " : String.fromCodePoint(cp);
    this.set(x, y, ch, 1, fg.packed, bg.packed, attributes);
  }

  setCellWithAlphaBlending(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes = 0): void {
    x = Math.trunc(x); y = Math.trunc(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const cp = char.codePointAt(0) ?? 32;
    const ch = cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? " " : String.fromCodePoint(cp);
    this.blend(x, y, ch, 1, fg.packed, bg.packed, attributes);
  }

  drawChar(char: number, x: number, y: number, fg: RGBA, bg: RGBA, attributes = 0): void {
    this.setCellWithAlphaBlending(x, y, String.fromCodePoint(char), fg, bg, attributes);
  }

  /**
   * A row of text (drawTextChecked, through TextRow): each cluster at its width, blanks for tabs
   * and controls; a glyph is drawn only if all of it is inside the buffer and the scissor. Without
   * a background it keeps the background under each cell.
   */
  drawText(text: string, x: number, y: number, fg: RGBA, bg?: RGBA, attributes = 0): void {
    this.drawTextPacked(text, Math.trunc(x), Math.trunc(y), fg.packed, bg?.packed, attributes);
  }

  drawTextPacked(text: string, x: number, y: number, fg: number, bg: number | undefined, attrs: number): void {
    if (y < 0 || y >= this.height || x >= this.width || !text) return;
    if (alpha(fg) === 0 && (bg === undefined || alpha(bg) === 0)) return;
    let advance = 0;
    for (const c of clusters(text)) {
      if (x + advance >= this.width) break;
      if (c.width === 0) continue;
      const gx = x + advance;
      advance += c.width;
      const blank = !isPrintable(c.text);
      if (!blank && gx < 0) continue;
      const first = Math.max(gx, 0);
      const end = Math.min(gx + c.width, this.width);
      const count = blank ? Math.max(0, end - first) : 1;
      // A glyph needs all its cells inside; a blank, any one of them.
      if (blank) {
        for (let k = 0; k < count; k++) {
          const cx = first + k;
          const background = bg ?? this.bg[y * this.width + cx]!;
          this.textCell(cx, y, " ", 1, fg, background, attrs);
        }
        continue;
      }
      if (c.width > this.width - first) continue;
      let inside = true;
      for (let k = 0; k < c.width; k++) if (!this.isPointInScissor(first + k, y)) { inside = false; break; }
      if (!inside) continue;
      const background = bg ?? this.bg[y * this.width + first]!;
      this.textCell(first, y, c.text, c.width, fg, background, attrs);
    }
  }

  /** setTextCell: see-through backgrounds blend, the rest is set. */
  private textCell(x: number, y: number, char: string, width: number, fg: number, bg: number, attrs: number): void {
    if (alpha(bg) < 255 || alpha(fg) < 255) this.blend(x, y, char, width, fg, bg, attrs);
    else this.set(x, y, char, width, fg, bg, attrs);
  }

  fillRect(x: number, y: number, width: number, height: number, bg: RGBA | number): void {
    const b = typeof bg === "number" ? bg : bg.packed;
    x = Math.trunc(x); y = Math.trunc(y); width = Math.trunc(width); height = Math.trunc(height);
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + width), y1 = Math.min(this.height, y + height);
    if (x0 >= x1 || y0 >= y1 || !this.isRectInScissor(x0, y0, x1 - x0, y1 - y0)) return;
    if (alpha(b) === 0) return;
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        if (!this.isPointInScissor(cx, cy)) continue;
        if (alpha(b) === 255) this.set(cx, cy, " ", 1, WHITE, b, 0);
        else this.blend(cx, cy, " ", 1, WHITE, b, 0);
      }
    }
  }

  /** A box (drawVisibleBox): fill, the border's sides with corners where two meet, and a title in the top side. */
  drawBox(options: {
    x: number; y: number; width: number; height: number; borderStyle?: BorderStyle; border: boolean | Array<"top" | "right" | "bottom" | "left">;
    borderColor: RGBA | number; backgroundColor: RGBA | number; shouldFill?: boolean; title?: string | undefined; titleColor?: RGBA | number | undefined;
    titleAlignment?: "left" | "center" | "right"; bottomTitle?: string | undefined; bottomTitleAlignment?: "left" | "center" | "right";
  }): void {
    const sides = sidesOf(options.border);
    const pack = (c: RGBA | number) => (typeof c === "number" ? c : c.packed);
    drawBoxCells(this, Math.trunc(options.x), Math.trunc(options.y), Math.trunc(options.width), Math.trunc(options.height), BORDER_CHARS[options.borderStyle ?? "single"], sides,
      pack(options.borderColor), pack(options.backgroundColor), pack(options.titleColor ?? options.borderColor), options.shouldFill ?? true,
      options.title, options.titleAlignment ?? "left", options.bottomTitle, options.bottomTitleAlignment ?? "left");
  }

  /** Copy another buffer onto this one (drawFrameBuffer); a respectAlpha source blends. */
  drawFrameBuffer(destX: number, destY: number, source: OptimizedBuffer): void {
    for (let sy = 0; sy < source.height; sy++) {
      for (let sx = 0; sx < source.width; sx++) {
        const i = sy * source.width + sx;
        const w = source.widths[i]!;
        if (w === 0) continue;
        const x = destX + sx, y = destY + sy;
        if (source.respectAlpha) this.blend(x, y, source.chars[i]!, w, source.fg[i]!, source.bg[i]!, source.attrs[i]!);
        else this.set(x, y, source.chars[i]!, w, source.fg[i]!, source.bg[i]!, source.attrs[i]!);
      }
    }
  }

  /** The buffer's text, a row a line (wide characters once, as a terminal shows them). */
  charFrame(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = "";
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        if (this.widths[i] === 0) continue;
        row += this.chars[i];
      }
      rows.push(row);
    }
    // As OpenTUI's captureCharFrame: every row ends with a newline.
    return `${rows.join("\n")}\n`;
  }
}

export function sidesOf(border: boolean | Array<"top" | "right" | "bottom" | "left">): BorderSides {
  if (border === true) return { top: true, right: true, bottom: true, left: true };
  if (Array.isArray(border)) return { top: border.includes("top"), right: border.includes("right"), bottom: border.includes("bottom"), left: border.includes("left") };
  return { top: false, right: false, bottom: false, left: false };
}

export function intersect(a: ClipRect, b: ClipRect): ClipRect | undefined {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const ex = Math.min(a.x + a.width, b.x + b.width), ey = Math.min(a.y + a.height, b.y + b.height);
  if (x >= ex || y >= ey) return undefined;
  return { x, y, width: ex - x, height: ey - y };
}

/** Where a box's title goes (computeBoxTitleLayout), or nowhere: it needs its side, and four cells to spare. */
function titleLayout(text: string | undefined, side: boolean, atSide: boolean, startX: number, endX: number, width: number, alignment: "left" | "center" | "right"): { draw: boolean; x: number; start: number; end: number } {
  if (!text || !side || !atSide) return { draw: false, x: startX, start: 0, end: -1 };
  const length = stringWidth(text);
  if (width < length + 4) return { draw: false, x: startX, start: 0, end: -1 };
  const padding = 2;
  let x = startX + padding;
  if (alignment === "center") x = startX + Math.max(padding, Math.floor((width - length) / 2));
  else if (alignment === "right") x = startX + width - padding - length;
  x = Math.max(startX + padding, Math.min(x, endX - length));
  return { draw: true, x, start: x, end: x + length - 1 };
}

/** drawVisibleBox, cell for cell. */
export function drawBoxCells(buf: OptimizedBuffer, x: number, y: number, width: number, height: number, chars: readonly string[], sides: BorderSides, borderColor: number, background: number, titleColor: number, shouldFill: boolean,
  title: string | undefined, titleAlignment: "left" | "center" | "right", bottomTitle: string | undefined, bottomTitleAlignment: "left" | "center" | "right"): void {
  const borderTransparent = alpha(borderColor) === 0 && alpha(background) === 0;
  const titleVisible = (!!title || !!bottomTitle) && !(alpha(titleColor) === 0 && alpha(background) === 0);
  if (borderTransparent && !titleVisible) return;
  const startX = Math.max(0, x), startY = Math.max(0, y);
  const endX = Math.min(buf.width - 1, x + width - 1), endY = Math.min(buf.height - 1, y + height - 1);
  if (startX > endX || startY > endY) return;
  const s = buf.scissor;
  if (s && (startX >= s.x + s.width || endX + 1 <= s.x || startY >= s.y + s.height || endY + 1 <= s.y)) return;
  const atLeft = startX === x, atRight = endX === x + width - 1, atTop = startY === y, atBottom = endY === y + height - 1;
  const top = titleLayout(title, sides.top, atTop, startX, endX, width, titleAlignment);
  const bottom = titleLayout(bottomTitle, sides.bottom, atBottom, startX, endX, width, bottomTitleAlignment);
  const [topLeft, topRight, bottomLeft, bottomRight, horizontal, vertical] = chars as [string, string, string, string, string, string];
  if (shouldFill) {
    if (!sides.top && !sides.right && !sides.bottom && !sides.left) buf.fillRect(startX, startY, endX - startX + 1, endY - startY + 1, background);
    else {
      const ix0 = startX + (sides.left && atLeft ? 1 : 0), iy0 = startY + (sides.top && atTop ? 1 : 0);
      const ix1 = endX - (sides.right && atRight ? 1 : 0), iy1 = endY - (sides.bottom && atBottom ? 1 : 0);
      if (ix1 >= ix0 && iy1 >= iy0) buf.fillRect(ix0, iy0, ix1 - ix0 + 1, iy1 - iy0 + 1, background);
    }
  }
  const put = (cx: number, cy: number, ch: string) => {
    if (alpha(borderColor) === 255 && alpha(background) === 255) buf.set(cx, cy, ch, 1, borderColor, background, 0);
    else buf.blend(cx, cy, ch, 1, borderColor, background, 0);
  };
  const leftOnly = sides.left && atLeft && !sides.top && !sides.bottom;
  const rightOnly = sides.right && atRight && !sides.top && !sides.bottom;
  const bottomWithVerticals = sides.bottom && atBottom && !sides.top && (sides.left || sides.right);
  const topWithVerticals = sides.top && atTop && !sides.bottom && (sides.left || sides.right);
  const extendTop = leftOnly || rightOnly || bottomWithVerticals;
  const extendBottom = leftOnly || rightOnly || topWithVerticals;
  if (sides.top && atTop) {
    for (let dx = startX; dx <= endX; dx++) {
      if (top.draw && dx >= top.start && dx <= top.end) continue;
      let ch = horizontal;
      if (dx === startX && atLeft) ch = sides.left ? topLeft : horizontal;
      else if (dx === endX && atRight) ch = sides.right ? topRight : horizontal;
      put(dx, startY, ch);
    }
  }
  if (sides.bottom && atBottom) {
    for (let dx = startX; dx <= endX; dx++) {
      if (bottom.draw && dx >= bottom.start && dx <= bottom.end) continue;
      let ch = horizontal;
      if (dx === startX && atLeft) ch = sides.left ? bottomLeft : horizontal;
      else if (dx === endX && atRight) ch = sides.right ? bottomRight : horizontal;
      put(dx, endY, ch);
    }
  }
  const vy0 = extendTop ? startY : startY + (sides.top && atTop ? 1 : 0);
  const vy1 = extendBottom ? endY : endY - (sides.bottom && atBottom ? 1 : 0);
  if (sides.left || sides.right) {
    for (let dy = vy0; dy <= vy1; dy++) {
      if (sides.left && atLeft) put(startX, dy, vertical);
      if (sides.right && atRight) put(endX, dy, vertical);
    }
  }
  if (top.draw && title) buf.drawTextPacked(title, top.x, startY, titleColor, background, 0);
  if (bottom.draw && bottomTitle) buf.drawTextPacked(bottomTitle, bottom.x, endY, titleColor, background, 0);
}

export { codepointWidth, parseColor, RGBA, type ColorInput };
