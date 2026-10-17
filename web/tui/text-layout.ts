// Copied from the prototype's src/web/tui/text-layout.ts at 44c6d4a, whole, unchanged.
import type { OptimizedBuffer } from "./buffer.ts";
import { clusters, isPrintable } from "./width.ts";

/**
 * Text laid out as OpenTUI's native text buffer view lays it out (packages/native/src/
 * text-buffer-view.zig): styled chunks split into logical lines at line breaks, then into the
 * lines on screen for a width, by word (at spaces, after - / \ . , ; : ! ? ( ) [ ] { } and between
 * CJK characters), by character, or not at all; and drawn into a viewport of the text's own box
 * (drawTextBufferInternal), left, centred or right.
 */

export type WrapMode = "none" | "char" | "word";
export type TextAlign = "left" | "center" | "right";

export interface StyledChunk { text: string; fg: number; bg: number; attrs: number }

/** How a glyph breaks a line: whitespace (a separator), after it (punctuation, CJK), or not at all. */
const GlyphKind = { Other: 0, Space: 1, BreakAfter: 2 } as const;
type GlyphKind = (typeof GlyphKind)[keyof typeof GlyphKind];

/** A cell's worth of styled text. */
export interface Glyph { text: string; width: number; fg: number; bg: number; attrs: number; kind: GlyphKind }

export interface TextLine { glyphs: Glyph[]; width: number }

const ASCII_BREAK_AFTER = new Set(["-", "/", "\\", ".", ",", ";", ":", "!", "?", "(", ")", "[", "]", "{", "}"]);
const UNICODE_SPACES = new Set([0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x200b]);
const UNICODE_BREAK_AFTER = new Set([0x00ad, 0x2010, 0x3001, 0x3002, 0xff01, 0xff0c, 0xff1a, 0xff1f]);

function isCjk(cp: number): boolean {
  return (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2fa1f) ||
    (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9d) ||
    (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff);
}

function kindOf(text: string): GlyphKind {
  if (text === " " || text === "\t") return GlyphKind.Space;
  if (text.length === 1 && ASCII_BREAK_AFTER.has(text)) return GlyphKind.BreakAfter;
  const cp = text.codePointAt(0)!;
  if (UNICODE_SPACES.has(cp)) return GlyphKind.Space;
  if (UNICODE_BREAK_AFTER.has(cp) || isCjk(cp)) return GlyphKind.BreakAfter;
  return GlyphKind.Other;
}

/** The logical lines of some styled chunks: \r\n, \n and \r end a line. */
export function logicalLines(chunks: StyledChunk[]): Glyph[][] {
  const lines: Glyph[][] = [[]];
  for (const chunk of chunks) {
    const parts = chunk.text.split(/\r\n|\n|\r/);
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      const line = lines[lines.length - 1]!;
      for (const c of clusters(part)) line.push({ text: c.text, width: c.width, fg: chunk.fg, bg: chunk.bg, attrs: chunk.attrs, kind: kindOf(c.text) });
    });
  }
  return lines;
}

const sum = (glyphs: Glyph[]) => glyphs.reduce((n, g) => n + g.width, 0);

/** The lines on screen for a wrap width (undefined or mode "none": the logical lines as they are). */
export function wrapLines(logical: Glyph[][], mode: WrapMode, wrapWidth: number | undefined): TextLine[] {
  if (mode === "none" || wrapWidth === undefined) return logical.map(glyphs => ({ glyphs, width: sum(glyphs) }));
  const out: TextLine[] = [];
  for (const line of logical) {
    if (mode === "char") charWrap(line, wrapWidth, out);
    else wordWrap(line, wrapWidth, out);
  }
  return out;
}

/** Lines and the widest of them for a width (measureForDimensions): 0 means no wrapping. */
export function measure(logical: Glyph[][], mode: WrapMode, width: number): { lineCount: number; maxWidth: number } {
  if (width === 0 || mode === "none") {
    let maxWidth = 0;
    for (const line of logical) maxWidth = Math.max(maxWidth, sum(line));
    return { lineCount: logical.length, maxWidth };
  }
  const lines = wrapLines(logical, mode, width);
  let maxWidth = 0;
  for (const line of lines) maxWidth = Math.max(maxWidth, line.width);
  return { lineCount: lines.length, maxWidth };
}

class LineBuilder {
  glyphs: Glyph[] = [];
  width = 0;
  private readonly out: TextLine[];
  constructor(out: TextLine[]) { this.out = out; }
  add(gs: Glyph[]): void { for (const g of gs) { this.glyphs.push(g); this.width += g.width; } }
  commit(): void { this.out.push({ glyphs: this.glyphs, width: this.width }); this.glyphs = []; this.width = 0; }
}

function charWrap(line: Glyph[], wrapWidth: number, out: TextLine[]): void {
  const b = new LineBuilder(out);
  const total = sum(line);
  let done = 0;
  for (let i = 0; i < line.length; i++) {
    const g = line[i]!;
    if (g.width === 0) { b.add([g]); continue; }
    if (b.width + g.width > wrapWidth) {
      if (b.width > 0) b.commit();
    }
    b.add([g]);
    done += g.width;
    if (b.width >= wrapWidth && done < total) b.commit();
  }
  if (b.glyphs.length > 0 || total === 0) b.commit();
}

/** Word wrap, as calculateVirtualLinesGeneric(.word) places words and separators. */
function wordWrap(line: Glyph[], wrapWidth: number, out: TextLine[]): void {
  const b = new LineBuilder(out);
  const limit = Math.max(wrapWidth, 1);
  let hasNonWhitespace = false;
  let word: Glyph[] = [];

  /** placeCompleteWordPiece: on this line if it fits, else the next; a word wider than a line is split by glyph. */
  const place = (piece: Glyph[]) => {
    let rest = piece;
    let restWidth = sum(rest);
    while (restWidth > 0) {
      if (restWidth <= limit) {
        if (b.width > 0 && b.width + restWidth > limit) b.commit();
        b.add(rest);
        return;
      }
      if (b.width > 0) b.commit();
      // As many glyphs as fit (zero-width ones stay with the glyph before), at least one.
      let n = 0, w = 0;
      while (n < rest.length && w + rest[n]!.width <= limit) { w += rest[n]!.width; n++; }
      if (n === 0) { w = rest[0]!.width; n = 1; }
      while (n < rest.length && rest[n]!.width === 0) n++;
      b.add(rest.slice(0, n));
      rest = rest.slice(n);
      restWidth -= w;
      if (restWidth > 0) b.commit();
    }
    if (rest.length) b.add(rest);
  };

  const endWord = () => {
    if (!word.length) return;
    if (sum(word) > 0) hasNonWhitespace = true;
    place(word);
    word = [];
  };

  for (const g of line) {
    if (g.kind === GlyphKind.Space) {
      endWord();
      // Indentation is content; a separator where the line wraps (or right after it) is dropped.
      if (hasNonWhitespace && b.width + g.width > limit) { if (b.width > 0) b.commit(); continue; }
      if (hasNonWhitespace && b.width === 0) continue;
      place([g]);
    } else if (g.kind === GlyphKind.BreakAfter) {
      word.push(g);
      endWord();
    } else word.push(g);
  }
  endWord();
  if (b.glyphs.length > 0 || sum(line) === 0) b.commit();
}

/** Left padding to align a line of this width in the viewport (alignmentPadCols). */
export function alignPad(align: TextAlign, viewportWidth: number, lineWidth: number): number {
  if (lineWidth >= viewportWidth) return 0;
  return align === "center" ? Math.floor((viewportWidth - lineWidth) / 2) : align === "right" ? viewportWidth - lineWidth : 0;
}

const INVERSE = 1 << 5;

/**
 * Draw lines into a buffer at (x, y) through a viewport: lines from viewport.y, as many as its
 * height; columns from viewport.x, as many as its width (drawTextBufferInternal).
 */
export function drawLines(buf: OptimizedBuffer, lines: TextLine[], x: number, y: number, viewport: { x: number; y: number; width: number; height: number }, align: TextAlign): void {
  const first = y < 0 ? -y : 0;
  const visible = lines.slice(Math.min(viewport.y, lines.length), Math.min(viewport.y + viewport.height, lines.length));
  const last = y >= buf.height ? 0 : Math.min(visible.length, buf.height - Math.max(y, 0) + first);
  let currentY = y + first;
  for (let li = first; li < last; li++) {
    if (currentY >= buf.height) break;
    const line = visible[li]!;
    let currentX = x + alignPad(align, viewport.width, line.width);
    let col = 0;
    for (const g of line.glyphs) {
      const w = g.width;
      if (w === 0) continue;
      if (col < viewport.x) { col += w; continue; }
      if (col >= viewport.x + viewport.width) break;
      if (currentX + w <= 0) { currentX += w; col += w; continue; }
      if (currentX >= buf.width) break;
      const blank = !isPrintable(g.text);
      let fg = g.fg, bg = g.bg;
      if (g.attrs & INVERSE) { const t = fg; fg = bg; bg = t; }
      if (blank) {
        for (let k = 0; k < w; k++) {
          if (col + k >= viewport.x + viewport.width) break;
          const cx = currentX + k;
          if (cx < 0) continue;
          if (cx >= buf.width) break;
          if (!buf.isPointInScissor(cx, currentY)) continue;
          buf.blend(cx, currentY, " ", 1, fg, bg, g.attrs);
        }
        currentX += w; col += w;
        continue;
      }
      if (!buf.isPointInScissor(currentX, currentY)) { currentX += w; col += w; continue; }
      if (w > 1) {
        let fits = !(col + w > viewport.x + viewport.width || currentX < 0 || currentX + w > buf.width);
        for (let k = 1; fits && k < w; k++) if (!buf.isPointInScissor(currentX + k, currentY)) fits = false;
        if (!fits) { currentX += w; col += w; continue; }
      }
      buf.blend(currentX, currentY, g.text, w, fg, bg, g.attrs);
      currentX += w; col += w;
    }
    currentY++;
  }
}
