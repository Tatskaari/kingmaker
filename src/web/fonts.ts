import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The hook for custom glyph fonts: every .ttf or .otf in assets/fonts gets an @font-face, and its
 * family goes at the front of the terminal's font stack. The family, weight and style come from the
 * font's own tables and the unicode-range from its cmap, so a font of private-use glyphs is only
 * used for those glyphs and never changes the size of the terminal's cells.
 */

export interface WebFont {
  /** The file in assets/fonts, served at /fonts/<file>. */
  file: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** Code point ranges the font covers; empty means use it for everything. */
  ranges: Array<[number, number]>;
}

const FILE = /^[\w.-]+\.(ttf|otf)$/i;

export function webFonts(dir: string): WebFont[] {
  if (!existsSync(dir)) return [];
  const fonts: WebFont[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!FILE.test(file)) continue;
    try {
      fonts.push({ file, ...describe(readFileSync(join(dir, file))) });
    } catch {
      // A font we can't read is still offered, named after its file and used for everything.
      const stem = file.replace(/\.\w+$/, "");
      fonts.push({ file, family: stem.replace(/[-_](regular|bold|italic|bolditalic)$/i, ""), weight: /bold/i.test(stem) ? 700 : 400, style: /italic/i.test(stem) ? "italic" : "normal", ranges: [] });
    }
  }
  return fonts;
}

export function isFontFile(name: string): boolean {
  return FILE.test(name);
}

export function fontFaceCss(fonts: WebFont[]): string {
  return fonts.map(font => {
    const lines = [
      `  font-family: "${cssString(font.family)}";`,
      `  src: url("/fonts/${encodeURIComponent(font.file)}") format("${font.file.toLowerCase().endsWith(".otf") ? "opentype" : "truetype"}");`,
      `  font-weight: ${font.weight};`,
      `  font-style: ${font.style};`,
      "  font-display: block;",
    ];
    if (font.ranges.length) lines.push(`  unicode-range: ${font.ranges.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(", ")};`);
    return `@font-face {\n${lines.join("\n")}\n}\n`;
  }).join("\n");
}

/** What the page needs to load a font before it measures the terminal's cells. */
export function fontList(fonts: WebFont[]): Array<{ family: string; weight: number; style: string; sample: string }> {
  return fonts.map(font => ({
    family: font.family,
    weight: font.weight,
    style: font.style,
    sample: font.ranges.length ? String.fromCodePoint(font.ranges[0]![0]) : "W",
  }));
}

const hex = (n: number) => n.toString(16).toUpperCase();
const cssString = (s: string) => s.replace(/["\\\n]/g, "");

/** Family, weight, style and coverage from an sfnt's name, OS/2 and cmap tables. */
function describe(data: Buffer): Omit<WebFont, "file"> {
  const tables = new Map<string, number>();
  const count = data.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    tables.set(data.toString("latin1", at, at + 4), data.readUInt32BE(at + 8));
  }
  const name = tables.get("name");
  const os2 = tables.get("OS/2");
  const cmap = tables.get("cmap");
  if (name === undefined || cmap === undefined) throw new Error("not a font we can read");
  const family = nameRecord(data, name, 16) ?? nameRecord(data, name, 1);
  if (!family) throw new Error("no family name");
  const weight = os2 !== undefined ? data.readUInt16BE(os2 + 4) : 400;
  const italic = os2 !== undefined ? (data.readUInt16BE(os2 + 62) & 1) === 1 : false;
  let ranges = coverage(data, cmap);
  // A whole text font (more than a few hundred runs) is simply used for everything.
  if (ranges.length > 300) ranges = [];
  return { family, weight: weight || 400, style: italic ? "italic" : "normal", ranges };
}

function nameRecord(data: Buffer, table: number, id: number): string | undefined {
  const count = data.readUInt16BE(table + 2);
  const strings = table + data.readUInt16BE(table + 4);
  let mac: string | undefined;
  for (let i = 0; i < count; i++) {
    const at = table + 6 + 12 * i;
    const platform = data.readUInt16BE(at);
    if (data.readUInt16BE(at + 6) !== id) continue;
    const length = data.readUInt16BE(at + 8);
    const start = strings + data.readUInt16BE(at + 10);
    const bytes = data.subarray(start, start + (length & ~1));
    if (platform === 3 || platform === 0) return Buffer.from(bytes).swap16().toString("utf16le");
    if (platform === 1) mac ??= bytes.toString("latin1");
  }
  return mac;
}

function coverage(data: Buffer, table: number): Array<[number, number]> {
  const count = data.readUInt16BE(table + 2);
  let format4: number | undefined;
  for (let i = 0; i < count; i++) {
    const sub = table + data.readUInt32BE(table + 4 + 8 * i + 4);
    const format = data.readUInt16BE(sub);
    if (format === 12) {
      const groups = data.readUInt32BE(sub + 12);
      const ranges: Array<[number, number]> = [];
      for (let g = 0; g < groups; g++) ranges.push([data.readUInt32BE(sub + 16 + 12 * g), data.readUInt32BE(sub + 20 + 12 * g)]);
      return merge(ranges);
    }
    if (format === 4) format4 ??= sub;
  }
  if (format4 === undefined) return [];
  const segments = data.readUInt16BE(format4 + 6) / 2;
  const ranges: Array<[number, number]> = [];
  for (let s = 0; s < segments; s++) {
    const end = data.readUInt16BE(format4 + 14 + 2 * s);
    const start = data.readUInt16BE(format4 + 16 + 2 * segments + 2 * s);
    if (start !== 0xffff) ranges.push([start, end]);
  }
  return merge(ranges);
}

function merge(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
