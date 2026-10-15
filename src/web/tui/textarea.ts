import type { OptimizedBuffer } from "./buffer.ts";
import type { KeyEvent, MouseEvent, PasteEvent } from "./events.ts";
import { MeasureMode, PositionType, Renderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";
import { drawLines, logicalLines, measure, wrapLines, type Glyph, type TextLine, type WrapMode } from "./text-layout.ts";
import { clusters } from "./width.ts";

/**
 * A multi-line text box: @opentui/core's TextareaRenderable (Textarea.ts over EditBufferRenderable.ts),
 * whose editing and view are native (packages/native/src/edit-buffer.zig, editor-view.zig,
 * text-buffer-view.zig), redone here as those do it:
 * - The text is logical lines of grapheme clusters, a column a cell; the cursor is a row and a
 *   column (and the column it wants, for going up and down), and an offset counts cells with one
 *   for each line break.
 * - It's laid out in visual lines as a <text> is (the same word wrap), each knowing its logical
 *   line, the column it starts at (a separator dropped at a wrap stays in the line before) and its
 *   offset; the placeholder stands in while it's empty.
 * - The view keeps the cursor in sight with a margin of a fifth of its height (ensureCursorVisible),
 *   whenever the cursor moves and before every paint; up and down move by visual line, keeping
 *   the column they want; the wheel moves the view and brings the cursor into it (makeCursorVisible).
 * - A left click puts the cursor on the cell clicked, as the native selection does when it starts:
 *   it holds that zero-width selection (and the view leaves the cursor be) until a move, a delete,
 *   a new line or any other click lets it go. Dragging doesn't select (nothing here selects).
 * - The keys are Textarea's: moves, word moves, deletes, Enter a new line, Meta+Enter submit, undo
 *   and redo; Shift with a move moves (without selecting).
 * - The terminal's own cursor, a blinking block, is where the cursor is while it has the focus.
 */

export interface TextareaOptions extends RenderableOptions<TextareaRenderable> {
  initialValue?: string;
  placeholder?: string | null;
  placeholderColor?: ColorInput;
  textColor?: ColorInput;
  backgroundColor?: ColorInput;
  focusedTextColor?: ColorInput;
  focusedBackgroundColor?: ColorInput;
  wrapMode?: WrapMode;
  scrollMargin?: number;
  showCursor?: boolean;
  cursorColor?: ColorInput;
  selectable?: boolean;
  onSubmit?: (event: object) => void;
  onContentChange?: (event: object) => void;
  onCursorChange?: (event: { line: number; visualColumn: number }) => void;
}

type Action = "move-left" | "move-right" | "move-up" | "move-down" | "line-home" | "line-end" | "visual-line-home" | "visual-line-end"
  | "buffer-home" | "buffer-end" | "delete-line" | "delete-to-line-end" | "delete-to-line-start" | "backspace" | "delete" | "newline"
  | "undo" | "redo" | "word-forward" | "word-backward" | "delete-word-forward" | "delete-word-backward" | "select-all" | "submit";

/** defaultTextareaKeyBindings; the select- ones move without selecting. */
const BINDINGS: Array<{ name: string; ctrl?: boolean; meta?: boolean; shift?: boolean; super?: boolean; action: Action }> = [
  { name: "left", action: "move-left" }, { name: "right", action: "move-right" }, { name: "up", action: "move-up" }, { name: "down", action: "move-down" },
  { name: "left", shift: true, action: "move-left" }, { name: "right", shift: true, action: "move-right" }, { name: "up", shift: true, action: "move-up" }, { name: "down", shift: true, action: "move-down" },
  { name: "home", action: "buffer-home" }, { name: "end", action: "buffer-end" }, { name: "home", shift: true, action: "buffer-home" }, { name: "end", shift: true, action: "buffer-end" },
  { name: "a", ctrl: true, action: "line-home" }, { name: "e", ctrl: true, action: "line-end" }, { name: "a", ctrl: true, shift: true, action: "line-home" }, { name: "e", ctrl: true, shift: true, action: "line-end" },
  { name: "a", meta: true, action: "visual-line-home" }, { name: "e", meta: true, action: "visual-line-end" }, { name: "a", meta: true, shift: true, action: "visual-line-home" }, { name: "e", meta: true, shift: true, action: "visual-line-end" },
  { name: "f", ctrl: true, action: "move-right" }, { name: "b", ctrl: true, action: "move-left" },
  { name: "w", ctrl: true, action: "delete-word-backward" }, { name: "backspace", ctrl: true, action: "delete-word-backward" },
  { name: "d", meta: true, action: "delete-word-forward" }, { name: "delete", meta: true, action: "delete-word-forward" }, { name: "delete", ctrl: true, action: "delete-word-forward" },
  { name: "d", ctrl: true, shift: true, action: "delete-line" }, { name: "k", ctrl: true, action: "delete-to-line-end" }, { name: "u", ctrl: true, action: "delete-to-line-start" },
  { name: "backspace", action: "backspace" }, { name: "backspace", shift: true, action: "backspace" },
  { name: "d", ctrl: true, action: "delete" }, { name: "delete", action: "delete" }, { name: "delete", shift: true, action: "delete" },
  { name: "return", action: "newline" }, { name: "kpenter", action: "newline" }, { name: "linefeed", action: "newline" },
  { name: "return", meta: true, action: "submit" }, { name: "kpenter", meta: true, action: "submit" },
  { name: "-", ctrl: true, action: "undo" }, { name: ".", ctrl: true, action: "redo" }, { name: "z", super: true, action: "undo" }, { name: "z", super: true, shift: true, action: "redo" },
  { name: "f", meta: true, action: "word-forward" }, { name: "b", meta: true, action: "word-backward" }, { name: "right", meta: true, action: "word-forward" }, { name: "left", meta: true, action: "word-backward" },
  { name: "right", ctrl: true, action: "word-forward" }, { name: "left", ctrl: true, action: "word-backward" },
  { name: "f", meta: true, shift: true, action: "word-forward" }, { name: "b", meta: true, shift: true, action: "word-backward" }, { name: "right", meta: true, shift: true, action: "word-forward" }, { name: "left", meta: true, shift: true, action: "word-backward" },
  { name: "backspace", meta: true, action: "delete-word-backward" },
  { name: "left", super: true, action: "visual-line-home" }, { name: "right", super: true, action: "visual-line-end" }, { name: "up", super: true, action: "buffer-home" }, { name: "down", super: true, action: "buffer-end" },
  { name: "left", super: true, shift: true, action: "visual-line-home" }, { name: "right", super: true, shift: true, action: "visual-line-end" }, { name: "up", super: true, shift: true, action: "buffer-home" }, { name: "down", super: true, shift: true, action: "buffer-end" },
  { name: "a", super: true, action: "select-all" },
];

/** A key's sequence with a control character in it is a key with no binding, not text. */
const UNSUPPORTED = /[\x00-\x1f\x7f-\x9f]/;
/** Where a word ends, for word moves (the wrap's breaks: a separator, or after punctuation). */
const BREAK = /^[\s\-/\\.,;:!?()[\]{}]$/u;

interface Cursor { row: number; col: number; desired: number }
/** A visual line: its logical line, the column it starts at there, its width, its offset in the text, and its cells. */
interface VLine { row: number; colStart: number; width: number; offset: number; glyphs: Glyph[] }
type Cell = { text: string; width: number };

/** The textarea that holds the zero-width selection a click started (any left click lets it go first). */
let holding: TextareaRenderable | undefined;
/** A left click somewhere (the renderer's, before it goes anywhere): any selection a textarea held is let go. */
export function releaseSelections(): void { holding?.releaseSelection(); }

export class TextareaRenderable extends Renderable {
  protected static override readonly defaultFocusable: boolean = true;
  private lines: Cell[][] = [[]];
  private cursor: Cursor = { row: 0, col: 0, desired: 0 };
  /** The column up and down keep to while they're pressed one after another (desired_visual_col). */
  private desiredVisual: number | undefined;
  private viewportY = 0;
  private held = false;
  private vlinesCache: { width: number; mode: WrapMode; empty: boolean; lines: VLine[] } | undefined;
  private history: Array<{ text: string; cursor: Cursor }> = [];
  private future: Array<{ text: string; cursor: Cursor }> = [];
  private initialSet = false;
  private _placeholder: string | null;
  private _placeholderColor: RGBA;
  private _textColor: RGBA;
  private _backgroundColor: RGBA;
  private _focusedTextColor: RGBA;
  private _focusedBackgroundColor: RGBA;
  private _wrapMode: WrapMode;
  private _scrollMargin: number;
  private _showCursor: boolean;
  private _cursorColor: RGBA;
  private submitListener: ((event: object) => void) | undefined;
  private contentListener: ((event: object) => void) | undefined;
  private cursorListener: ((event: { line: number; visualColumn: number }) => void) | undefined;

  constructor(ctx: RenderContext, options: TextareaOptions) {
    super(ctx, options);
    this.selectable = options.selectable ?? true;
    this._textColor = RGBA.clone(parseColor(options.textColor || "#FFFFFF"));
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor || "transparent"));
    this._focusedTextColor = RGBA.clone(parseColor(options.focusedTextColor || options.textColor || "#FFFFFF"));
    this._focusedBackgroundColor = RGBA.clone(parseColor(options.focusedBackgroundColor || options.backgroundColor || "transparent"));
    this._placeholder = options.placeholder ?? null;
    this._placeholderColor = RGBA.clone(parseColor(options.placeholderColor ?? "#666666"));
    this._wrapMode = options.wrapMode ?? "word";
    this._scrollMargin = Math.max(0, Math.min(0.5, options.scrollMargin ?? 0.2));
    this._showCursor = options.showCursor ?? true;
    this._cursorColor = RGBA.clone(parseColor(options.cursorColor ?? RGBA.fromValues(1, 1, 1, 1)));
    this.submitListener = options.onSubmit;
    this.contentListener = options.onContentChange;
    this.cursorListener = options.onCursorChange;
    // Measured before anything marks it dirty (Yoga won't mark a node without a measure).
    this.yogaNode.setMeasureFunc((width, widthMode, height) => this.measureFor(width, widthMode, height));
    if (options.initialValue) { this.setText(options.initialValue); this.initialSet = true; }
  }

  // ------------------------------------------------------------------------------------------
  // Properties

  get plainText(): string { return this.lines.map(l => l.map(c => c.text).join("")).join("\n"); }
  set initialValue(value: string) { if (!this.initialSet) { this.setText(value ?? ""); this.initialSet = true; } }
  get placeholder(): string | null { return this._placeholder; }
  set placeholder(value: string | null | undefined) { const v = value ?? null; if (v !== this._placeholder) { this._placeholder = v; this.contentChanged(false); } }
  set placeholderColor(value: ColorInput) { this._placeholderColor = RGBA.clone(parseColor(value ?? "#666666")); this.requestRender(); }
  set textColor(value: ColorInput) { this._textColor = RGBA.clone(parseColor(value ?? "#FFFFFF")); this.requestRender(); }
  set backgroundColor(value: ColorInput) { this._backgroundColor = RGBA.clone(parseColor(value ?? "transparent")); this.requestRender(); }
  set focusedTextColor(value: ColorInput) { this._focusedTextColor = RGBA.clone(parseColor(value ?? "#FFFFFF")); this.requestRender(); }
  set focusedBackgroundColor(value: ColorInput) { this._focusedBackgroundColor = RGBA.clone(parseColor(value ?? "transparent")); this.requestRender(); }
  get wrapMode(): WrapMode { return this._wrapMode; }
  set wrapMode(value: WrapMode) { const v = value ?? "word"; if (v !== this._wrapMode) { this._wrapMode = v; this.contentChanged(false); } }
  set scrollMargin(value: number) { this._scrollMargin = Math.max(0, Math.min(0.5, value ?? 0.2)); }
  get showCursor(): boolean { return this._showCursor; }
  set showCursor(value: boolean) { this._showCursor = value ?? true; this.requestRender(); }
  set cursorColor(value: ColorInput) { this._cursorColor = RGBA.clone(parseColor(value ?? "#FFFFFF")); this.requestRender(); }
  set onSubmit(handler: ((event: object) => void) | undefined) { this.submitListener = handler; }
  get onSubmit(): ((event: object) => void) | undefined { return this.submitListener; }
  set onContentChange(handler: ((event: object) => void) | undefined) { this.contentListener = handler; }
  get onContentChange(): ((event: object) => void) | undefined { return this.contentListener; }
  set onCursorChange(handler: ((event: { line: number; visualColumn: number }) => void) | undefined) { this.cursorListener = handler; }
  get onCursorChange(): ((event: { line: number; visualColumn: number }) => void) | undefined { return this.cursorListener; }

  get lineCount(): number { return this.lines.length; }
  get virtualLineCount(): number { return this.vlines().length; }
  get scrollY(): number { return this.viewportY; }
  get logicalCursor(): { row: number; col: number; offset: number } { return { row: this.cursor.row, col: this.cursor.col, offset: this.offsetOf(this.cursor.row, this.cursor.col) }; }
  get visualCursor(): { visualRow: number; visualCol: number; logicalRow: number; logicalCol: number; offset: number } {
    this.beforePaint();
    const v = this.visual();
    return { visualRow: Math.max(0, v.row - this.viewportY), visualCol: v.col, logicalRow: this.cursor.row, logicalCol: this.cursor.col, offset: this.offsetOf(this.cursor.row, this.cursor.col) };
  }
  get cursorOffset(): number { return this.visualCursor.offset; }
  set cursorOffset(offset: number) {
    this.releaseSelection();
    const c = this.coordsOf(offset ?? 0);
    this.setCursorTo(c.row, c.col);
    this.beforePaint();
    this.requestRender();
  }

  // ------------------------------------------------------------------------------------------
  // The text: lines of cells, offsets, columns

  private static cellsOf(text: string): Cell[] { return clusters(text).map(c => ({ text: c.text, width: c.width })); }
  private lineWidth(row: number): number { return (this.lines[row] ?? []).reduce((n, c) => n + c.width, 0); }
  private offsetOf(row: number, col: number): number {
    let o = 0;
    for (let r = 0; r < row && r < this.lines.length; r++) o += this.lineWidth(r) + 1;
    return o + col;
  }
  /** An offset as a row and column (past the end: the end). */
  private coordsOf(offset: number): { row: number; col: number } {
    let rest = Math.max(0, offset);
    for (let r = 0; r < this.lines.length; r++) {
      const w = this.lineWidth(r);
      if (rest <= w) return { row: r, col: rest };
      rest -= w + 1;
    }
    const last = this.lines.length - 1;
    return { row: last, col: this.lineWidth(last) };
  }
  /** The cells of a row before a column, and the one at it: index and where it starts. */
  private cellAt(row: number, col: number): { index: number; start: number } {
    let start = 0;
    const line = this.lines[row] ?? [];
    for (let i = 0; i < line.length; i++) {
      const w = line[i]!.width;
      if (col < start + Math.max(1, w)) return { index: i, start };
      start += w;
    }
    return { index: line.length, start };
  }
  /** The start of the unit a column falls in (a wide character's second cell is its first). */
  private snapColumn(row: number, col: number): number { return Math.min(col, this.cellAt(row, col).start); }
  private unsnappedColumn(): number { return this.snapColumn(this.cursor.row, this.cursor.desired) === this.cursor.col ? this.cursor.desired : this.cursor.col; }
  private prevWidth(row: number, col: number): number {
    let start = 0;
    for (const c of this.lines[row] ?? []) { if (start + c.width === col) return c.width; start += c.width; if (start > col) break; }
    return 0;
  }
  private widthAt(row: number, col: number): number {
    let start = 0;
    for (const c of this.lines[row] ?? []) { if (start === col) return c.width; start += c.width; if (start > col) break; }
    return 0;
  }

  // ------------------------------------------------------------------------------------------
  // Visual lines (text-buffer-view.zig's virtual lines)

  private contentChanged(edited: boolean): void {
    this.vlinesCache = undefined;
    this.yogaNode.markDirty();
    this.layoutChanged();
    if (edited) this.contentListener?.({});
  }

  private get empty(): boolean { return this.lines.length === 1 && this.lines[0]!.length === 0; }

  private logical(): Glyph[][] {
    if (this.empty && this._placeholder) return logicalLines([{ text: this._placeholder, fg: 0, bg: 0, attrs: 0 }]);
    return logicalLines(this.lines.map((l, i) => ({ text: `${i ? "\n" : ""}${l.map(c => c.text).join("")}`, fg: 0, bg: 0, attrs: 0 })));
  }

  /** The visual lines at the view's width: each logical line wrapped as a <text> wraps it. */
  private vlines(): VLine[] {
    const width = Math.trunc(this.width);
    const mode = this._wrapMode;
    const empty = this.empty;
    if (this.vlinesCache && this.vlinesCache.width === width && this.vlinesCache.mode === mode && this.vlinesCache.empty === empty) return this.vlinesCache.lines;
    const out: VLine[] = [];
    let offset = 0;
    this.logical().forEach((glyphs, row) => {
      // Each glyph's column in its line, to know where a visual line starts (dropped separators are skipped).
      const cols = new Map<Glyph, number>();
      let col = 0;
      for (const g of glyphs) { cols.set(g, col); col += g.width; }
      const wrapped: TextLine[] = mode === "none" || width <= 0 ? [{ glyphs, width: col }] : wrapLines([glyphs], mode, width);
      for (const line of wrapped) {
        const colStart = line.glyphs.length ? cols.get(line.glyphs[0]!) ?? 0 : 0;
        out.push({ row, colStart, width: line.width, offset: offset + colStart, glyphs: line.glyphs });
      }
      offset += col + 1;
    });
    this.vlinesCache = { width, mode, empty, lines: out };
    return out;
  }

  /** The visual line a logical position is on (findVisualLineIndex): a wrap boundary belongs to the line after it. */
  private visualIndex(row: number, col: number): number {
    const vl = this.vlines();
    const first = vl.findIndex(v => v.row === row);
    if (first < 0) return Math.max(0, vl.length - 1);
    let i = first;
    while (i + 1 < vl.length && vl[i + 1]!.row === row && col >= vl[i + 1]!.colStart) i++;
    return i;
  }

  /** The cursor's visual line and column (logicalToVisualCursor). */
  private visual(row = this.cursor.row, col = this.cursor.col): { row: number; col: number } {
    const index = this.visualIndex(row, col);
    const v = this.vlines()[index];
    if (!v) return { row: 0, col: 0 };
    return { row: index, col: col >= v.colStart ? Math.min(col - v.colStart, v.width) : 0 };
  }

  private marginLines(height: number, forMove: boolean): number {
    const raw = Math.max(1, Math.trunc(Math.fround(Math.fround(height) * Math.fround(this._scrollMargin))));
    return forMove ? Math.min(raw, height - 1) : Math.min(raw, height > 1 ? Math.floor((height - 1) / 2) : 0);
  }

  /** Keep the cursor's line in the view, a margin from its edges (ensureCursorVisible). */
  private ensureCursorVisible(line: number): void {
    const height = Math.trunc(this.height), width = Math.trunc(this.width);
    if (height <= 0 || width <= 0) return;
    const margin = this.marginLines(height, false);
    const total = this.vlines().length;
    const maxY = total > height ? total - height : 0;
    if (line < this.viewportY + margin) this.viewportY = line >= margin ? line - margin : 0;
    else if (line >= this.viewportY + height - margin) this.viewportY = Math.min(line + margin - height + 1, maxY);
  }

  /** Bring the cursor into the view where it's moved (makeCursorVisible): to the margin's row, its column kept. */
  private makeCursorVisible(): void {
    const height = Math.trunc(this.height);
    if (height <= 0 || Math.trunc(this.width) <= 0) return;
    const margin = this.marginLines(height, true);
    const v = this.visual();
    const y = this.viewportY;
    const above = v.row < y || v.row < y + margin;
    const below = v.row >= y + height || v.row >= y + height - margin;
    if (!above && !below) return;
    const target = above ? y + margin : y + height - margin - 1;
    const line = this.vlines()[target];
    if (!line) return;
    const desired = Math.min(this.unsnappedColumn(), this.lineWidth(line.row));
    this.cursor = { row: line.row, col: this.snapColumn(line.row, desired), desired };
  }

  /** What the native view does whenever the cursor moves (onCursorChanged). */
  private cursorChanged(): void {
    this.desiredVisual = undefined;
    if (!this.held) this.ensureCursorVisible(this.visual().row);
    const v = this.visual();
    this.cursorListener?.({ line: this.cursor.row, visualColumn: v.col });
    this.requestRender();
  }

  /** Before a paint (updateBeforeRender): the cursor in sight, unless a click is holding it where it is. */
  private beforePaint(): void { if (!this.held) this.ensureCursorVisible(this.visual().row); }

  // ------------------------------------------------------------------------------------------
  // Editing (edit-buffer.zig), each an undo step

  private snapshot(): void {
    this.history.push({ text: this.plainText, cursor: { ...this.cursor } });
    if (this.history.length > 500) this.history.shift();
    this.future = [];
  }

  private setLines(text: string): void {
    this.lines = text.replace(/\r\n?/g, "\n").split("\n").map(l => TextareaRenderable.cellsOf(l));
  }

  private setCursorTo(row: number, col: number): void {
    const r = Math.max(0, Math.min(row, this.lines.length - 1));
    const c = Math.max(0, Math.min(col, this.lineWidth(r)));
    this.cursor = { row: r, col: c, desired: c };
    this.cursorChanged();
  }

  /** Set the text and start again (no undo, the cursor at the start). */
  setText(text: string): void {
    this.setLines(text ?? "");
    this.history = []; this.future = [];
    this.cursor = { row: 0, col: 0, desired: 0 };
    this.contentChanged(true);
    this.cursorChanged();
  }

  /** Replace the text, as an undo step (the cursor at the start). */
  replaceText(text: string): void {
    this.snapshot();
    this.setLines(text ?? "");
    this.cursor = { row: 0, col: 0, desired: 0 };
    this.contentChanged(true);
    this.cursorChanged();
  }

  clear(): void { this.setText(""); }

  insertText(text: string): void {
    const clean = (text ?? "").replace(/\r\n?/g, "\n");
    if (!clean) return;
    this.snapshot();
    const { row, col } = this.cursor;
    const line = this.lines[row]!;
    const at = this.cellAt(row, col).index;
    const before = line.slice(0, at), after = line.slice(at);
    const parts = clean.split("\n").map(p => TextareaRenderable.cellsOf(p));
    if (parts.length === 1) {
      this.lines[row] = [...before, ...parts[0]!, ...after];
      const c = col + parts[0]!.reduce((n, x) => n + x.width, 0);
      this.cursor = { row, col: c, desired: c };
    } else {
      const last = parts.at(-1)!;
      this.lines.splice(row, 1, [...before, ...parts[0]!], ...parts.slice(1, -1), [...last, ...after]);
      const c = last.reduce((n, x) => n + x.width, 0);
      this.cursor = { row: row + parts.length - 1, col: c, desired: c };
    }
    this.contentChanged(true);
    this.cursorChanged();
  }

  /** Delete from one position to another (the cursor ends at the start). */
  private deleteRange(r1: number, c1: number, r2: number, c2: number): void {
    if (r1 > r2 || (r1 === r2 && c1 > c2)) [r1, c1, r2, c2] = [r2, c2, r1, c1];
    if (r1 === r2 && c1 === c2) return;
    this.snapshot();
    const head = this.lines[r1]!.slice(0, this.cellAt(r1, c1).index);
    const tail = this.lines[r2]!.slice(this.cellAt(r2, c2).index);
    this.lines.splice(r1, r2 - r1 + 1, [...head, ...tail]);
    this.cursor = { row: r1, col: c1, desired: c1 };
    this.contentChanged(true);
    this.cursorChanged();
  }

  deleteCharBackward(): boolean {
    this.releaseSelection();
    const { row, col } = this.cursor;
    if (row === 0 && col === 0) return true;
    if (col === 0) this.deleteRange(row - 1, this.lineWidth(row - 1), row, 0);
    else { const w = this.prevWidth(row, col); if (w) this.deleteRange(row, col - w, row, col); }
    return true;
  }

  deleteChar(): boolean {
    this.releaseSelection();
    const { row, col } = this.cursor;
    if (col >= this.lineWidth(row)) { if (row + 1 < this.lines.length) this.deleteRange(row, this.lineWidth(row), row + 1, 0); }
    else { const w = this.widthAt(row, col); if (w) this.deleteRange(row, col, row, col + w); }
    return true;
  }

  newLine(): boolean { this.releaseSelection(); this.insertText("\n"); return true; }

  deleteLine(): boolean {
    this.releaseSelection();
    const { row } = this.cursor;
    if (row + 1 < this.lines.length) this.deleteRange(row, 0, row + 1, 0);
    else if (row > 0) this.deleteRange(row - 1, this.lineWidth(row - 1), row, this.lineWidth(row));
    else if (this.lineWidth(row) > 0) this.deleteRange(row, 0, row, this.lineWidth(row));
    return true;
  }

  deleteToLineEnd(): boolean {
    const { row, col } = this.cursor;
    if (this.lineWidth(row) > col) this.deleteRange(row, col, row, this.lineWidth(row));
    this.requestRender();
    return true;
  }

  deleteToLineStart(): boolean {
    const { row, col } = this.cursor;
    if (col > 0) this.deleteRange(row, 0, row, col);
    else if (row > 0) this.deleteRange(row - 1, this.lineWidth(row - 1), row, 0);
    this.requestRender();
    return true;
  }

  /**
   * The next word boundary (getNextWordBoundary): just after the first break past the cursor on its
   * line (a break at the cursor itself doesn't count), else the next line's start, else the line's end.
   */
  private nextWord(): { row: number; col: number } {
    const { row, col } = this.cursor;
    let at = 0;
    for (const c of this.lines[row] ?? []) {
      const end = at + c.width;
      if (BREAK.test(c.text) && at > col && end > col) return { row, col: end };
      at = end;
    }
    return row + 1 < this.lines.length ? { row: row + 1, col: 0 } : { row, col: this.lineWidth(row) };
  }

  /** The last word boundary before the cursor on its line (getPrevWordBoundary: just after a break), else the end of the line before. */
  private prevWord(): { row: number; col: number } {
    const { row, col } = this.cursor;
    if (row === 0 && col === 0) return { row, col };
    let at = 0, last: number | undefined;
    for (const c of this.lines[row] ?? []) {
      const end = at + c.width;
      if (BREAK.test(c.text) && end < col) last = end;
      at = end;
      if (at >= col) break;
    }
    if (last !== undefined) return { row, col: last };
    return row > 0 ? { row: row - 1, col: this.lineWidth(row - 1) } : { row: 0, col: 0 };
  }

  deleteWordForward(): boolean {
    this.releaseSelection();
    const next = this.nextWord();
    if (this.offsetOf(next.row, next.col) > this.offsetOf(this.cursor.row, this.cursor.col)) this.deleteRange(this.cursor.row, this.cursor.col, next.row, next.col);
    this.requestRender();
    return true;
  }

  deleteWordBackward(): boolean {
    this.releaseSelection();
    const prev = this.prevWord();
    if (this.offsetOf(prev.row, prev.col) < this.offsetOf(this.cursor.row, this.cursor.col)) this.deleteRange(prev.row, prev.col, this.cursor.row, this.cursor.col);
    this.requestRender();
    return true;
  }

  undo(): boolean {
    this.releaseSelection();
    const last = this.history.pop();
    if (!last) return true;
    this.future.push({ text: this.plainText, cursor: { ...this.cursor } });
    this.setLines(last.text);
    this.contentChanged(true);
    this.setCursorTo(last.cursor.row, last.cursor.col);
    this.cursor.desired = last.cursor.desired;
    return true;
  }

  redo(): boolean {
    this.releaseSelection();
    const next = this.future.pop();
    if (!next) return true;
    this.history.push({ text: this.plainText, cursor: { ...this.cursor } });
    this.setLines(next.text);
    this.contentChanged(true);
    this.setCursorTo(next.cursor.row, next.cursor.col);
    this.cursor.desired = next.cursor.desired;
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Moving (EditBufferRenderable's moves: each lets a click's selection go)

  moveCursorLeft(): boolean {
    this.releaseSelection();
    const { row, col } = this.cursor;
    if (col > 0) { const c = col - this.prevWidth(row, col); this.cursor = { row, col: c, desired: c }; }
    else if (row > 0) { const c = this.lineWidth(row - 1); this.cursor = { row: row - 1, col: c, desired: c }; }
    this.cursorChanged();
    return true;
  }

  moveCursorRight(): boolean {
    this.releaseSelection();
    const { row, col } = this.cursor;
    if (col < this.lineWidth(row)) { const c = col + this.widthAt(row, col); this.cursor = { row, col: c, desired: c }; }
    else if (row + 1 < this.lines.length) this.cursor = { row: row + 1, col: 0, desired: 0 };
    this.cursorChanged();
    return true;
  }

  /** Up or down a visual line, keeping the column wanted (moveToVisualRow). */
  private moveToVisualRow(target: number): void {
    const vl = this.vlines();
    const v = this.visual();
    const desired = this.desiredVisual ?? v.col + (this.unsnappedColumn() - this.cursor.col);
    const line = vl[target]!;
    let col = Math.min(desired, line.width);
    // A wrap boundary is the next line's start: one back keeps it on this one.
    if (col === line.width && line.width > 0 && target + 1 < vl.length && vl[target + 1]!.row === line.row) col = line.width - 1;
    const logicalCol = line.colStart + col;
    this.cursor = { row: line.row, col: this.snapColumn(line.row, logicalCol), desired: logicalCol };
    this.desiredVisual = desired;
    this.ensureCursorVisible(target);
    this.requestRender();
  }

  moveCursorUp(): boolean {
    this.releaseSelection();
    const v = this.visual();
    if (v.row > 0) this.moveToVisualRow(v.row - 1);
    return true;
  }

  moveCursorDown(): boolean {
    this.releaseSelection();
    const v = this.visual();
    if (!(this.empty && this._placeholder) && v.row + 1 < this.vlines().length) this.moveToVisualRow(v.row + 1);
    return true;
  }

  setCursor(row: number, col: number): void { this.releaseSelection(); this.setCursorTo(row, col); }

  gotoLineHome(): boolean {
    this.releaseSelection();
    const { row, col } = this.cursor;
    if (col === 0 && row > 0) this.setCursorTo(row - 1, this.lineWidth(row - 1));
    else this.setCursorTo(row, 0);
    return true;
  }

  gotoLineEnd(): boolean {
    this.releaseSelection();
    const { row, col } = this.cursor;
    const eol = this.lineWidth(row);
    if (col === eol && row < this.lines.length - 1) this.setCursorTo(row + 1, 0);
    else this.setCursorTo(row, eol);
    return true;
  }

  gotoVisualLineHome(): boolean {
    this.releaseSelection();
    const line = this.vlines()[this.visual().row];
    if (line) this.setCursorTo(line.row, line.colStart);
    return true;
  }

  gotoVisualLineEnd(): boolean {
    this.releaseSelection();
    const vl = this.vlines(), index = this.visual().row, line = vl[index];
    if (!line) return true;
    let col = line.width;
    if (col > 0 && index + 1 < vl.length && vl[index + 1]!.row === line.row) col = line.width - 1;
    this.setCursorTo(line.row, line.colStart + col);
    return true;
  }

  gotoBufferHome(): boolean { this.releaseSelection(); this.setCursorTo(0, 0); return true; }
  gotoBufferEnd(): boolean { this.releaseSelection(); const last = this.lines.length - 1; this.setCursorTo(last, this.lineWidth(last)); return true; }

  moveWordForward(): boolean { this.releaseSelection(); const n = this.nextWord(); this.setCursorTo(n.row, n.col); return true; }
  moveWordBackward(): boolean { this.releaseSelection(); const p = this.prevWord(); this.setCursorTo(p.row, p.col); return true; }

  submit(): boolean { this.submitListener?.({}); return true; }

  // ------------------------------------------------------------------------------------------
  // Keys, pastes and the mouse

  private act(action: Action): boolean {
    switch (action) {
      case "move-left": return this.moveCursorLeft();
      case "move-right": return this.moveCursorRight();
      case "move-up": return this.moveCursorUp();
      case "move-down": return this.moveCursorDown();
      case "line-home": return this.gotoLineHome();
      case "line-end": return this.gotoLineEnd();
      case "visual-line-home": return this.gotoVisualLineHome();
      case "visual-line-end": return this.gotoVisualLineEnd();
      case "buffer-home": return this.gotoBufferHome();
      case "buffer-end": return this.gotoBufferEnd();
      case "delete-line": return this.deleteLine();
      case "delete-to-line-end": return this.deleteToLineEnd();
      case "delete-to-line-start": return this.deleteToLineStart();
      case "backspace": return this.deleteCharBackward();
      case "delete": return this.deleteChar();
      case "newline": return this.newLine();
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "word-forward": return this.moveWordForward();
      case "word-backward": return this.moveWordBackward();
      case "delete-word-forward": return this.deleteWordForward();
      case "delete-word-backward": return this.deleteWordBackward();
      case "select-all": return this.gotoBufferEnd();
      case "submit": return this.submit();
    }
  }

  override handleKeyPress(key: KeyEvent): boolean {
    const binding = BINDINGS.find(b => b.name === key.name && !!b.ctrl === key.ctrl && !!b.meta === key.meta && !!b.shift === key.shift && !!b.super === !!key.super);
    if (binding) return this.act(binding.action);
    if (!key.ctrl && !key.meta && !key.super && !key.hyper) {
      if (key.name === "space") { this.insertText(" "); return true; }
      if (key.sequence && !UNSUPPORTED.test(key.sequence)) { this.insertText(key.sequence); return true; }
    }
    return false;
  }

  override handlePaste(event: PasteEvent): void {
    this.insertText(new TextDecoder().decode(event.bytes).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ""));
  }

  /** A zero-width selection a click started stops holding the cursor where it is. */
  releaseSelection(): void {
    this.held = false;
    if (holding === this) holding = undefined;
  }

  /**
   * Where a click lands (coordsToCharOffset): the visual line under it (clamped to the text), the
   * cell under it (not past the line's last cell where it wraps on), as an offset in the text.
   */
  private offsetAt(localX: number, localY: number): number {
    const vl = this.vlines();
    if (!vl.length || (this.empty && this._placeholder)) return 0;
    const index = Math.max(0, Math.min(localY + this.viewportY, vl.length - 1));
    const line = vl[index]!;
    const wraps = index + 1 < vl.length && vl[index + 1]!.row === line.row;
    const max = line.width === 0 ? 0 : wraps ? line.width - 1 : line.width;
    const x = Math.max(0, Math.min(localX, max));
    if (x === line.width && !wraps) {
      const end = line.colStart + line.width, whole = this.lineWidth(line.row);
      if (whole > end) return line.offset - line.colStart + whole;
    }
    return line.offset + x;
  }

  /** A left click on it: the cursor to the cell clicked, held there as the native selection holds it. */
  override processMouseEvent(event: MouseEvent): void {
    if (event.type === "down" && event.button === 0 && !event.modifiers?.ctrl && this.selectable && event.target === this) {
      const at = this.coordsOf(this.offsetAt(event.x - Math.trunc(this._layout.screenX), event.y - Math.trunc(this._layout.screenY)));
      const col = this.snapColumn(at.row, at.col);
      this.cursor = { row: at.row, col, desired: col };
      this.desiredVisual = undefined;
      holding?.releaseSelection();
      this.held = true;
      holding = this;
      this.requestRender();
    }
    super.processMouseEvent(event);
  }

  /** The wheel: the view moves, and the cursor into it where it's left out (handleScroll, then makeCursorVisible). */
  protected override onMouseEvent(event: MouseEvent): void {
    if (event.type !== "scroll" || !event.scroll) return;
    const { direction, delta } = event.scroll;
    const height = Math.trunc(this.height);
    if (direction === "up") this.viewportY = Math.max(0, this.viewportY - delta);
    else if (direction === "down") this.viewportY = Math.min(this.viewportY + delta, Math.max(0, this.vlines().length - height));
    else return;
    this.makeCursorVisible();
    this.requestRender();
  }

  // ------------------------------------------------------------------------------------------
  // Size and drawing

  /** As a <text> measures (NativeRenderable.measure): its lines at a width, no bigger than it's allowed. */
  private measureFor(width: number, widthMode: MeasureMode, height: number): { width: number; height: number } {
    const effectiveWidth = widthMode === MeasureMode.Undefined || Number.isNaN(width) ? 0 : width;
    const effectiveHeight = Number.isNaN(height) ? 1 : height;
    const measureWidth = !Number.isFinite(effectiveWidth) || effectiveWidth <= 0 ? 0 : Math.floor(effectiveWidth);
    const result = measure(this.logical(), this._wrapMode, measureWidth);
    let w = Math.max(1, result.maxWidth);
    let h = Math.max(1, result.lineCount);
    if (widthMode === MeasureMode.AtMost && this.yogaNode.getPositionType() !== PositionType.Absolute) {
      w = Math.min(effectiveWidth, w);
      h = Math.min(effectiveHeight, h);
    }
    return { width: w, height: h };
  }

  /** A new size (setViewportSize): the view kept in range, the cursor in sight. */
  protected override onResize(width: number, height: number): void {
    this.vlinesCache = undefined;
    const total = this.vlines().length;
    const maxY = total > height ? total - height : 0;
    if (this.viewportY > maxY) this.viewportY = maxY;
    this.ensureCursorVisible(this.visual().row);
    super.onResize(width, height);
  }

  override focus(): void { super.focus(); this.requestRender(); }
  override blur(): void {
    super.blur();
    this._ctx.setCursorPosition(0, 0, false);
    this.requestRender();
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    this.beforePaint();
    const l = this._layout;
    const x = Math.trunc(l.screenX), y = Math.trunc(l.screenY), width = Math.trunc(l.width), height = Math.trunc(l.height);
    const fg = (this._focused ? this._focusedTextColor : this._textColor).packed;
    const bg = (this._focused ? this._focusedBackgroundColor : this._backgroundColor).packed;
    if ((bg & 0xff) !== 0) buffer.fillRect(x, y, width, height, bg);
    const color = this.empty && this._placeholder ? this._placeholderColor.packed : fg;
    const lines: TextLine[] = this.vlines().map(v => ({ width: v.width, glyphs: v.glyphs.map(g => ({ ...g, fg: color, bg })) }));
    drawLines(buffer, lines, x, y, { x: 0, y: this.viewportY, width, height }, "left");
    if (this._focused && this._showCursor && this._ctx.currentFocusedRenderable === this) {
      const v = this.visual();
      this._ctx.setCursorStyle({ style: "block", blinking: true, color: this._cursorColor });
      this._ctx.setCursorPosition(x + v.col + 1, y + v.row - this.viewportY + 1, true);
    }
  }
}
