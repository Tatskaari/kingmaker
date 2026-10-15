import type { Markup, MarkKind } from "../runtime/markup.ts";

/**
 * A GM reply laid out for the screen (src/app/ui/reply.tsx draws it): narration, each person's
 * spoken lines in their own colour, and the marked phrases (src/runtime/markup.ts), in paragraphs
 * broken where the speaker or the kind of text changes, word-wrapped to a width. The wrapping is
 * done here rather than by OpenTUI so that each marked phrase knows where it was drawn, and can be
 * clicked.
 */

/** A run of one style within a row. `mark`: the index of the mark it's part of. */
export interface Run { text: string; fg: string; underline?: boolean; bold?: boolean; bg?: string; mark?: number }
export type Row = Run[];

export interface Style {
  /** Narration's colour. */
  narration: string;
  /** A spoken line's colour, by who says it (undefined: nobody could tell). */
  speech: (speaker: string | undefined) => string;
  /** A marked phrase's colour, by its kind. */
  mark: (kind: MarkKind) => string;
  /** The mark picked out (Tab, the pointer), drawn on this background. */
  focus?: { mark: number; bg: string };
}

/** A paragraph's pieces: text of one kind (narration, a line, a mark within either). */
interface Piece { text: string; speech?: number; mark?: number }

/** Where the reply's styling changes: every edge of a spoken line and of a mark. */
function pieces(text: string, markup: Markup): Piece[] {
  const cuts = new Set<number>([0, text.length]);
  for (const s of markup.speech) { cuts.add(s.start); cuts.add(s.end); }
  for (const m of markup.marks) { cuts.add(m.start); cuts.add(m.end); }
  const at = [...cuts].filter(c => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const from = at[i]!, to = at[i + 1]!;
    if (to <= from) continue;
    const speech = markup.speech.findIndex(s => s.start <= from && to <= s.end);
    const mark = markup.marks.findIndex(m => m.start <= from && to <= m.end);
    out.push({ text: text.slice(from, to), ...(speech >= 0 ? { speech } : {}), ...(mark >= 0 ? { mark } : {}) });
  }
  return out;
}

const SENTENCE_END = /[.!?…]["”’)]*\s*$/;
const SAID_END = /[.!?…]["”]\s*$/;

/**
 * The reply as paragraphs. A blank line in it stays a blank line; a line break stays a break; and a
 * paragraph also breaks where the speaker or the kind of text changes at a sentence's edge: a line
 * after narration that ended its sentence, narration that starts a new sentence after a line, a
 * different speaker's line. A speech tag ("…,” she says, “…”) stays with its line.
 */
export function paragraphs(text: string, markup: Markup): Array<{ gap: boolean; pieces: Piece[] }> {
  const out: Array<{ gap: boolean; pieces: Piece[] }> = [];
  let current: Piece[] = [];
  let gap = false;
  const flush = (nextGap: boolean) => {
    // A paragraph keeps no edges of whitespace.
    while (current.length && !current[0]!.text.trimStart()) current.shift();
    while (current.length && !current.at(-1)!.text.trimEnd()) current.pop();
    if (current.length) {
      current[0] = { ...current[0]!, text: current[0]!.text.trimStart() };
      current[current.length - 1] = { ...current.at(-1)!, text: current.at(-1)!.text.trimEnd() };
      out.push({ gap, pieces: current });
      gap = false;
    }
    gap = gap || nextGap;
    current = [];
  };
  const kindOf = (p: Piece | undefined) => (p?.speech === undefined ? -1 : p.speech);
  for (const piece of pieces(text, markup)) {
    // Line breaks within a piece: a blank line is a gap, a single break a new paragraph.
    const parts = piece.text.split(/(\n[ \t]*\n\s*|\n)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (i % 2 === 1) { flush(/\n[ \t]*\n/.test(part)); continue; }
      if (!part) continue;
      const next: Piece = { ...piece, text: part };
      const prev = current.at(-1);
      const before = current.map(p => p.text).join("");
      if (prev && kindOf(prev) !== kindOf(next)) {
        const intoLine = kindOf(next) >= 0 && kindOf(prev) < 0 && SENTENCE_END.test(before);
        const outOfLine = kindOf(next) < 0 && kindOf(prev) >= 0 && SAID_END.test(prev.text) && /^\s*[A-Z“"]/.test(part);
        // Two lines with only space between: a break if it's someone else speaking.
        const between = [...current].reverse();
        const lastLine = between.find(p => kindOf(p) >= 0);
        const onlySpace = kindOf(prev) < 0 && !prev.text.trim() && lastLine;
        const otherSpeaker = kindOf(next) >= 0 && onlySpace && markup.speech[kindOf(lastLine!)]?.speaker !== markup.speech[kindOf(next)]?.speaker;
        if (intoLine || outOfLine || otherSpeaker) flush(false);
      }
      current.push(next);
    }
  }
  flush(false);
  return out;
}

/** Cells a character takes: two for wide ones (emoji, CJK), none for joiners. */
export function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c === 0x200d || (c >= 0x300 && c < 0x370) || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
  if (c >= 0x1f000 || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xff00 && c <= 0xff60)) return 2;
  return 1;
}
const widthOf = (s: string) => [...s].reduce((n, ch) => n + cellWidth(ch), 0);

interface Cell { ch: string; run: Omit<Run, "text"> }

/** A piece's style. */
function styleOf(piece: Piece, markup: Markup, style: Style): Omit<Run, "text"> {
  const mark = piece.mark !== undefined ? markup.marks[piece.mark] : undefined;
  const fg = mark ? style.mark(mark.kind) : piece.speech !== undefined ? style.speech(markup.speech[piece.speech]!.speaker) : style.narration;
  const focused = mark && style.focus?.mark === piece.mark;
  return { fg, ...(mark ? { underline: true, mark: piece.mark } : {}), ...(focused ? { bold: true, bg: style.focus!.bg } : {}) };
}

const sameRun = (a: Omit<Run, "text">, b: Omit<Run, "text">) => a.fg === b.fg && a.underline === b.underline && a.bold === b.bold && a.bg === b.bg && a.mark === b.mark;

/** A paragraph's cells as rows of runs, word-wrapped to `width` (a word longer than a row is broken). */
function wrapCells(cells: Cell[], width: number): Row[] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let used = 0;
  // Words and the spaces between them.
  const words: Cell[][] = [];
  for (const c of cells) {
    const space = c.ch === " ";
    const last = words.at(-1);
    if (!last || (last[0]!.ch === " ") !== space) words.push([c]);
    else last.push(c);
  }
  for (const word of words) {
    const w = word.reduce((n, c) => n + cellWidth(c.ch), 0);
    if (word[0]!.ch === " ") {
      // Spaces at a row's end or start aren't drawn.
      if (used && used + w < width) { row.push(...word); used += w; }
      else if (used) { rows.push(row); row = []; used = 0; }
      continue;
    }
    if (used + w > width && used) {
      while (row.length && row.at(-1)!.ch === " ") row.pop();
      rows.push(row); row = []; used = 0;
    }
    for (const c of word) {
      const cw = cellWidth(c.ch);
      if (used + cw > width && used) { rows.push(row); row = []; used = 0; }
      row.push(c); used += cw;
    }
  }
  while (row.length && row.at(-1)!.ch === " ") row.pop();
  if (row.length) rows.push(row);
  return rows.map(r => {
    const runs: Row = [];
    for (const c of r) {
      const last = runs.at(-1);
      if (last && sameRun(last, c.run)) last.text += c.ch;
      else runs.push({ text: c.ch, ...c.run });
    }
    return runs;
  });
}

/** The reply as rows for a width: its paragraphs wrapped, a blank row where it had a blank line. */
export function replyRows(text: string, markup: Markup, width: number, style: Style): Row[] {
  const rows: Row[] = [];
  for (const para of paragraphs(text, markup)) {
    if (para.gap && rows.length) rows.push([]);
    const cells: Cell[] = para.pieces.flatMap(p => { const run = styleOf(p, markup, style); return [...p.text.replace(/[\t\r]/g, " ")].map(ch => ({ ch, run })); });
    rows.push(...wrapCells(cells, Math.max(1, width)));
  }
  return rows;
}

/** A row's text, as drawn. */
export const rowText = (row: Row) => row.map(r => r.text).join("");
/** How wide a row is drawn. */
export const rowWidth = (row: Row) => widthOf(rowText(row));
