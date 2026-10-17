// Copied from the prototype's src/web/tui/width.ts at 44c6d4a, whole, unchanged.
import { Unicode11Addon } from "@xterm/addon-unicode11";

/**
 * How many cells a character takes, as the page's terminal draws it: xterm.js with its Unicode 11
 * widths (the page loads the same addon). The addon's provider is borrowed rather than its tables
 * copied, so the game lays text out with exactly the widths the terminal draws it with. A
 * zero-width code point (a combining mark, a variation selector, ZWJ) joins the cell before it, as
 * xterm joins it; controls take no cells; a tab is two blank cells, as in OpenTUI.
 */

interface WidthProvider { wcwidth(codepoint: number): number }

let provider: WidthProvider | undefined;
new Unicode11Addon().activate({ unicode: { register(p: WidthProvider) { provider = p; } } } as never);

const widthCache = new Map<number, number>();

/** Cells for one code point: 0, 1 or 2. */
export function codepointWidth(cp: number): number {
  if (cp < 0x7f) return cp >= 0x20 ? 1 : cp === 9 ? TAB_WIDTH : 0;
  let w = widthCache.get(cp);
  if (w === undefined) {
    w = cp >= 0x7f && cp < 0xa0 ? 0 : provider ? provider.wcwidth(cp) : 1;
    widthCache.set(cp, w);
  }
  return w;
}

export const TAB_WIDTH = 2;

/** One cell's worth of text: a base character and the zero-width code points that join it. */
export interface Cluster { text: string; width: number }

/** A string as the terminal's cells see it. Zero-width clusters (a mark with nothing before it) keep width 0. */
export function clusters(text: string): Cluster[] {
  const out: Cluster[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const w = codepointWidth(cp);
    const last = out[out.length - 1];
    if (w === 0 && last && cp >= 0x20 && last.text !== "\t") { last.text += ch; continue; }
    out.push({ text: ch, width: w });
  }
  return out;
}

/** Display width of a string. */
export function stringWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c < 0x7f) { width++; continue; }
    const cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    width += codepointWidth(cp);
  }
  return width;
}

/** Whether a cluster may sit in a cell (no controls in it). */
export function isPrintable(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return false;
  }
  return true;
}
