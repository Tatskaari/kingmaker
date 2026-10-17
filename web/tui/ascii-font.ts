// Copied from the prototype's src/web/tui/ascii-font.ts at 44c6d4a, whole, unchanged.
import type { OptimizedBuffer } from "./buffer.ts";
import { Renderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";

/**
 * Big letters (@opentui/core's ASCIIFont.ts and lib/ascii.font.ts, MIT; the fonts are cfonts'):
 * each character's rows, in up to two colours (<c1>, <c2>), drawn over what's beneath. The font
 * data is OpenTUI's own, read out of the installed @opentui/core at build time (see fonts in the
 * static build), so this file holds only the drawing.
 */

export interface FontDefinition { name: string; lines: number; letterspace_size: number; letterspace: string[]; colors?: number; chars: Record<string, string[]> }
interface Segment { text: string; colorIndex: number }
interface ParsedFont { lines: number; letterspace_size: number; chars: Record<string, Segment[][]> }

const registered = new Map<string, FontDefinition>();
const parsed = new Map<string, ParsedFont>();

/** Make a font available by name (the static build registers OpenTUI's). */
export function registerFont(name: string, font: FontDefinition): void {
  registered.set(name, font);
  parsed.delete(name);
}

function parseColorTags(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<c(\d+)>(.*?)<\/c\d+>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), colorIndex: 0 });
    segments.push({ text: m[2]!, colorIndex: Math.max(0, parseInt(m[1]!, 10) - 1) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), colorIndex: 0 });
  return segments;
}

function fontOf(name: string): ParsedFont | undefined {
  let font = parsed.get(name);
  if (font) return font;
  const def = registered.get(name);
  if (!def) return undefined;
  const chars: Record<string, Segment[][]> = {};
  for (const [ch, lines] of Object.entries(def.chars)) chars[ch] = lines.map(parseColorTags);
  font = { lines: def.lines, letterspace_size: def.letterspace_size, chars };
  parsed.set(name, font);
  return font;
}

const rowWidth = (segments: Segment[] | undefined) => (segments ?? []).reduce((n, s) => n + s.text.length, 0);

export function measureText({ text, font = "tiny" }: { text: string; font?: string }): { width: number; height: number } {
  const def = fontOf(font);
  if (!def) return { width: 0, height: 0 };
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const charDef = def.chars[text[i]!.toUpperCase()];
    if (!charDef) { const space = def.chars[" "]; x += space?.[0] ? rowWidth(space[0]) : 1; continue; }
    x += rowWidth(charDef[0]);
    if (i < text.length - 1) x += def.letterspace_size;
  }
  return { width: x, height: def.lines };
}

/** renderFontToFrameBuffer, straight onto the screen: the glyphs' non-space cells blend over what's there. */
function drawFont(buffer: OptimizedBuffer, text: string, x0: number, y0: number, maxW: number, maxH: number, colors: RGBA[], background: RGBA, font: string): void {
  const def = fontOf(font);
  if (!def || def.lines > maxH) return;
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const charDef = def.chars[text[i]!.toUpperCase()];
    if (!charDef) { const space = def.chars[" "]; x += space?.[0] ? rowWidth(space[0]) : 1; continue; }
    const w = rowWidth(charDef[0]);
    if (x >= maxW) break;
    if (x + w < 0) { x += w + def.letterspace_size; continue; }
    for (let line = 0; line < def.lines && line < charDef.length; line++) {
      let sx = x;
      for (const segment of charDef[line]!) {
        const color = (colors[segment.colorIndex] ?? colors[0])!;
        for (let k = 0; k < segment.text.length; k++) {
          const rx = sx + k;
          const ch = segment.text[k]!;
          if (rx >= 0 && rx < maxW && ch !== " ") buffer.blend(x0 + rx, y0 + line, ch, 1, color.packed, background.packed, 0);
        }
        sx += segment.text.length;
      }
    }
    x += w;
    if (i < text.length - 1) x += def.letterspace_size;
  }
}

export interface ASCIIFontOptions extends RenderableOptions<ASCIIFontRenderable> {
  text?: string;
  font?: string;
  color?: ColorInput | ColorInput[];
  backgroundColor?: ColorInput;
}

export class ASCIIFontRenderable extends Renderable {
  private _text: string;
  private _font: string;
  private _color: RGBA | RGBA[];
  private _backgroundColor: RGBA;

  constructor(ctx: RenderContext, options: ASCIIFontOptions) {
    const font = options.font || "tiny";
    const text = options.text || "";
    const size = measureText({ text, font });
    super(ctx, { flexShrink: 0, ...options, width: size.width || 1, height: size.height || 1 });
    this._text = text;
    this._font = font;
    const color = options.color || "#FFFFFF";
    this._color = Array.isArray(color) ? color.map(c => RGBA.clone(parseColor(c))) : RGBA.clone(parseColor(color));
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor || "transparent"));
  }

  get text(): string { return this._text; }
  set text(value: string) { this._text = value; this.updateDimensions(); this.requestRender(); }
  get font(): string { return this._font; }
  set font(value: string) { this._font = value; this.updateDimensions(); this.requestRender(); }
  set color(value: ColorInput | ColorInput[]) {
    const v = value ?? "#FFFFFF";
    this._color = Array.isArray(v) ? v.map(c => RGBA.clone(parseColor(c))) : RGBA.clone(parseColor(v));
    this.requestRender();
  }
  set backgroundColor(value: ColorInput) { this._backgroundColor = RGBA.clone(parseColor(value ?? "transparent")); this.requestRender(); }

  private updateDimensions(): void {
    const size = measureText({ text: this._text, font: this._font });
    this.width = size.width;
    this.height = size.height;
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const l = this._layout;
    const colors = Array.isArray(this._color) ? this._color : [this._color];
    // The frame buffer is cleared to the background first.
    if (this._backgroundColor.a > 0) buffer.fillRect(Math.trunc(l.screenX), Math.trunc(l.screenY), Math.trunc(l.width), Math.trunc(l.height), this._backgroundColor);
    drawFont(buffer, this._text, Math.trunc(l.screenX), Math.trunc(l.screenY), Math.trunc(l.width), Math.trunc(l.height), colors, this._backgroundColor, this._font);
  }
}
