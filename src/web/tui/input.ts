import type { OptimizedBuffer } from "./buffer.ts";
import type { KeyEvent, PasteEvent } from "./events.ts";
import { MeasureMode, PositionType, Renderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";
import { clusters, stringWidth } from "./width.ts";

/**
 * A one-line text input (@opentui/core's Input.ts over Textarea.ts and EditBufferRenderable.ts):
 * the Textarea's key bindings (moves, word moves, deletes, Enter submits), the text scrolled
 * sideways to keep the cursor a fifth of the width from the edge (the editor view's
 * ensureCursorVisible), a placeholder in grey while it's empty, and the terminal's own cursor,
 * a blinking block, where the cursor is while it has the focus.
 */

export interface InputRenderableOptions extends RenderableOptions<InputRenderable> {
  value?: string;
  placeholder?: string;
  placeholderColor?: ColorInput;
  textColor?: ColorInput;
  backgroundColor?: ColorInput;
  focusedTextColor?: ColorInput;
  focusedBackgroundColor?: ColorInput;
  maxLength?: number;
  minLength?: number;
  cursorColor?: ColorInput;
  showCursor?: boolean;
  /** How near the edge the cursor gets before the text scrolls, as a share of the width (the editor's: 0.2; a cell at the least). */
  scrollMargin?: number;
}

export const InputRenderableEvents = { INPUT: "input", CHANGE: "change", ENTER: "enter" } as const;

type Action = "move-left" | "move-right" | "line-home" | "line-end" | "word-forward" | "word-backward" | "backspace" | "delete"
  | "delete-word-backward" | "delete-word-forward" | "delete-to-line-end" | "delete-to-line-start" | "delete-line" | "submit" | "undo" | "redo" | "select-all";

const BINDINGS: Array<{ name: string; ctrl?: boolean; meta?: boolean; shift?: boolean; super?: boolean; action: Action }> = [
  { name: "left", action: "move-left" }, { name: "right", action: "move-right" },
  { name: "left", shift: true, action: "move-left" }, { name: "right", shift: true, action: "move-right" },
  { name: "home", action: "line-home" }, { name: "end", action: "line-end" },
  { name: "home", shift: true, action: "line-home" }, { name: "end", shift: true, action: "line-end" },
  { name: "a", ctrl: true, action: "line-home" }, { name: "e", ctrl: true, action: "line-end" },
  { name: "a", meta: true, action: "line-home" }, { name: "e", meta: true, action: "line-end" },
  { name: "f", ctrl: true, action: "move-right" }, { name: "b", ctrl: true, action: "move-left" },
  { name: "w", ctrl: true, action: "delete-word-backward" }, { name: "backspace", ctrl: true, action: "delete-word-backward" },
  { name: "d", meta: true, action: "delete-word-forward" }, { name: "delete", meta: true, action: "delete-word-forward" },
  { name: "delete", ctrl: true, action: "delete-word-forward" }, { name: "d", ctrl: true, shift: true, action: "delete-line" },
  { name: "k", ctrl: true, action: "delete-to-line-end" }, { name: "u", ctrl: true, action: "delete-to-line-start" },
  { name: "backspace", action: "backspace" }, { name: "backspace", shift: true, action: "backspace" },
  { name: "d", ctrl: true, action: "delete" }, { name: "delete", action: "delete" }, { name: "delete", shift: true, action: "delete" },
  { name: "return", action: "submit" }, { name: "kpenter", action: "submit" }, { name: "linefeed", action: "submit" },
  { name: "return", meta: true, action: "submit" }, { name: "kpenter", meta: true, action: "submit" },
  { name: "-", ctrl: true, action: "undo" }, { name: ".", ctrl: true, action: "redo" },
  { name: "z", super: true, action: "undo" }, { name: "z", super: true, shift: true, action: "redo" },
  { name: "f", meta: true, action: "word-forward" }, { name: "b", meta: true, action: "word-backward" },
  { name: "right", meta: true, action: "word-forward" }, { name: "left", meta: true, action: "word-backward" },
  { name: "right", ctrl: true, action: "word-forward" }, { name: "left", ctrl: true, action: "word-backward" },
  { name: "backspace", meta: true, action: "delete-word-backward" },
  { name: "left", super: true, action: "line-home" }, { name: "right", super: true, action: "line-end" },
  { name: "a", super: true, action: "select-all" },
];

const UNSUPPORTED = /[\x00-\x1f\x7f-\x9f]/;
const WORD = /[\p{L}\p{N}_]/u;

export class InputRenderable extends Renderable {
  protected static override readonly defaultFocusable: boolean = true;
  /** The text, a cluster a cell (a cluster per element). */
  private glyphs: string[] = [];
  /** The cursor: an index into glyphs. */
  private cursor = 0;
  private scrollX = 0;
  private _placeholder: string;
  private _placeholderColor: RGBA;
  private _textColor: RGBA;
  private _backgroundColor: RGBA;
  private _focusedTextColor: RGBA;
  private _focusedBackgroundColor: RGBA;
  private _maxLength: number;
  private _minLength: number;
  private _cursorColor: RGBA;
  private _showCursor: boolean;
  private _scrollMargin: number;
  private lastCommitted = "";
  private history: Array<{ value: string; cursor: number }> = [];
  private future: Array<{ value: string; cursor: number }> = [];

  constructor(ctx: RenderContext, options: InputRenderableOptions) {
    super(ctx, { ...options, height: 1 });
    this._maxLength = options.maxLength ?? 1000;
    this._minLength = options.minLength ?? 0;
    this._placeholder = options.placeholder ?? "";
    this._placeholderColor = RGBA.clone(parseColor(options.placeholderColor ?? "#666666"));
    this._textColor = RGBA.clone(parseColor(options.textColor || "#FFFFFF"));
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor || "transparent"));
    this._focusedTextColor = RGBA.clone(parseColor(options.focusedTextColor || options.textColor || "#FFFFFF"));
    this._focusedBackgroundColor = RGBA.clone(parseColor(options.focusedBackgroundColor || options.backgroundColor || "transparent"));
    this._cursorColor = RGBA.clone(parseColor(options.cursorColor ?? RGBA.fromValues(1, 1, 1, 1)));
    this._showCursor = options.showCursor ?? true;
    this._scrollMargin = options.scrollMargin ?? 0.2;
    const initial = (options.value ?? "").replace(/[\n\r]/g, "").substring(0, this._maxLength);
    this.glyphs = clusters(initial).map(c => c.text);
    this.cursor = this.glyphs.length;
    this.lastCommitted = initial;
    this.yogaNode.setMeasureFunc((width, widthMode, height) => {
      const effective = widthMode === MeasureMode.Undefined || Number.isNaN(width) ? 0 : width;
      let w = Math.max(1, stringWidth(this.plainText || this._placeholder));
      let h = 1;
      if (widthMode === MeasureMode.AtMost && this.yogaNode.getPositionType() !== PositionType.Absolute) {
        w = Math.min(effective, w);
        h = Math.min(Number.isNaN(height) ? 1 : height, h);
      }
      return { width: w, height: h };
    });
  }

  get plainText(): string { return this.glyphs.join(""); }
  get value(): string { return this.plainText; }
  set value(value: string) {
    const next = (value ?? "").substring(0, this._maxLength).replace(/[\n\r]/g, "");
    if (next === this.plainText) return;
    this.glyphs = clusters(next).map(c => c.text);
    this.cursor = this.glyphs.length;
    this.changed(false);
    this.emit(InputRenderableEvents.INPUT, next);
  }

  get cursorOffset(): number { return this.cursor; }
  set cursorOffset(offset: number) { this.cursor = Math.max(0, Math.min(this.glyphs.length, offset)); this.ensureCursorVisible(); this.requestRender(); }

  get placeholder(): string { return this._placeholder; }
  set placeholder(value: string | null | undefined) { const v = value ?? ""; if (v !== this._placeholder) { this._placeholder = v; this.yogaNode.markDirty(); this.layoutChanged(); } }
  set placeholderColor(value: ColorInput) { this._placeholderColor = RGBA.clone(parseColor(value ?? "#666666")); this.requestRender(); }
  set textColor(value: ColorInput) { this._textColor = RGBA.clone(parseColor(value ?? "#FFFFFF")); this.requestRender(); }
  set backgroundColor(value: ColorInput) { this._backgroundColor = RGBA.clone(parseColor(value ?? "transparent")); this.requestRender(); }
  set focusedTextColor(value: ColorInput) { this._focusedTextColor = RGBA.clone(parseColor(value ?? "#FFFFFF")); this.requestRender(); }
  set focusedBackgroundColor(value: ColorInput) { this._focusedBackgroundColor = RGBA.clone(parseColor(value ?? "transparent")); this.requestRender(); }
  get maxLength(): number { return this._maxLength; }
  set maxLength(value: number) { this._maxLength = value; if (this.plainText.length > value) this.value = this.plainText.substring(0, value); }
  get minLength(): number { return this._minLength; }
  set minLength(value: number) { this._minLength = value; }
  set scrollMargin(value: number | undefined) { this._scrollMargin = value ?? 0.2; this.ensureCursorVisible(); this.requestRender(); }
  // Single line: these are fixed.
  override set height(_value: number | "auto" | `${number}%`) {}
  override get height(): number { return super.height; }

  override focus(): void {
    super.focus();
    this.lastCommitted = this.plainText;
  }

  override blur(): void {
    if (!this.isDestroyed && this.plainText !== this.lastCommitted) {
      this.lastCommitted = this.plainText;
      this.emit(InputRenderableEvents.CHANGE, this.plainText);
    }
    super.blur();
    this._ctx.setCursorPosition(0, 0, false);
  }

  // ------------------------------------------------------------------------------------------
  // Editing

  private snapshot(): void {
    this.history.push({ value: this.plainText, cursor: this.cursor });
    if (this.history.length > 200) this.history.shift();
    this.future = [];
  }

  private changed(contentChanged = true): void {
    if (contentChanged) { this.yogaNode.markDirty(); this.layoutChanged(); }
    this.ensureCursorVisible();
    this.requestRender();
  }

  insertText(text: string): void {
    const clean = text.replace(/[\n\r]/g, "");
    if (!clean) return;
    const remaining = this._maxLength - this.plainText.length;
    if (remaining <= 0) return;
    const add = clusters(clean.substring(0, remaining)).map(c => c.text);
    this.snapshot();
    this.glyphs.splice(this.cursor, 0, ...add);
    this.cursor += add.length;
    this.changed();
    this.emit(InputRenderableEvents.INPUT, this.plainText);
  }

  private deleteRange(from: number, to: number): boolean {
    if (from >= to) return false;
    this.snapshot();
    this.glyphs.splice(from, to - from);
    this.cursor = from;
    this.changed();
    return true;
  }

  private emitInput<T>(result: T): T { this.emit(InputRenderableEvents.INPUT, this.plainText); return result; }

  deleteCharBackward(): boolean { return this.emitInput(this.cursor > 0 ? this.deleteRange(this.cursor - 1, this.cursor) : false); }
  deleteChar(): boolean { return this.emitInput(this.cursor < this.glyphs.length ? this.deleteRange(this.cursor, this.cursor + 1) : false); }
  deleteLine(): boolean { return this.emitInput(this.deleteRange(0, this.glyphs.length)); }
  deleteToLineEnd(): boolean { return this.emitInput(this.deleteRange(this.cursor, this.glyphs.length)); }
  deleteToLineStart(): boolean { return this.emitInput(this.deleteRange(0, this.cursor)); }
  deleteWordBackward(): boolean { return this.emitInput(this.deleteRange(this.wordBackward(), this.cursor)); }
  deleteWordForward(): boolean { return this.emitInput(this.deleteRange(this.cursor, this.wordForward())); }

  private wordBackward(): number {
    let i = this.cursor;
    while (i > 0 && !WORD.test(this.glyphs[i - 1]!)) i--;
    while (i > 0 && WORD.test(this.glyphs[i - 1]!)) i--;
    return i;
  }

  private wordForward(): number {
    let i = this.cursor;
    while (i < this.glyphs.length && !WORD.test(this.glyphs[i]!)) i++;
    while (i < this.glyphs.length && WORD.test(this.glyphs[i]!)) i++;
    return i;
  }

  private move(to: number): boolean {
    const at = Math.max(0, Math.min(this.glyphs.length, to));
    if (at === this.cursor) return false;
    this.cursor = at;
    this.ensureCursorVisible();
    this.requestRender();
    return true;
  }

  undo(): boolean {
    const last = this.history.pop();
    if (!last) return this.emitInput(false);
    this.future.push({ value: this.plainText, cursor: this.cursor });
    this.glyphs = clusters(last.value).map(c => c.text);
    this.cursor = last.cursor;
    this.changed();
    return this.emitInput(true);
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return this.emitInput(false);
    this.history.push({ value: this.plainText, cursor: this.cursor });
    this.glyphs = clusters(next.value).map(c => c.text);
    this.cursor = next.cursor;
    this.changed();
    return this.emitInput(true);
  }

  submit(): boolean {
    const value = this.plainText;
    if (value.length < this._minLength) return false;
    if (value !== this.lastCommitted) { this.lastCommitted = value; this.emit(InputRenderableEvents.CHANGE, value); }
    this.emit(InputRenderableEvents.ENTER, value);
    return true;
  }

  private act(action: Action): boolean {
    switch (action) {
      case "move-left": return this.move(this.cursor - 1);
      case "move-right": return this.move(this.cursor + 1);
      case "line-home": return this.move(0);
      case "line-end": return this.move(this.glyphs.length);
      case "word-forward": return this.move(this.wordForward());
      case "word-backward": return this.move(this.wordBackward());
      case "backspace": return this.deleteCharBackward();
      case "delete": return this.deleteChar();
      case "delete-word-backward": return this.deleteWordBackward();
      case "delete-word-forward": return this.deleteWordForward();
      case "delete-to-line-end": return this.deleteToLineEnd();
      case "delete-to-line-start": return this.deleteToLineStart();
      case "delete-line": return this.deleteLine();
      case "submit": return this.submit();
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "select-all": return true;
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
    const text = new TextDecoder().decode(event.bytes).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    this.insertText(text);
  }

  // ------------------------------------------------------------------------------------------
  // Drawing

  private cursorColumn(): number { return stringWidth(this.glyphs.slice(0, this.cursor).join("")); }

  /** ensureCursorVisible, sideways (no wrapping), with the editor's scroll margin (0.2 unless set). */
  private ensureCursorVisible(): void {
    const width = Math.trunc(this.width);
    if (width <= 0) return;
    const margin = Math.min(Math.max(1, Math.floor(width * this._scrollMargin)), width > 1 ? Math.floor((width - 1) / 2) : 0);
    const col = this.cursorColumn();
    if (col < this.scrollX + margin) this.scrollX = col >= margin ? col - margin : 0;
    else if (col >= this.scrollX + width - margin) this.scrollX = col + margin - width + 1;
  }

  /** After a resize, the scroll is kept in range and the cursor in sight (setViewportSize). */
  protected override onResize(width: number, height: number): void {
    const total = stringWidth(this.plainText);
    const maxX = total > width ? total - width : 0;
    if (this.scrollX > maxX) this.scrollX = maxX;
    this.ensureCursorVisible();
    super.onResize(width, height);
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const l = this._layout;
    const x = Math.trunc(l.screenX), y = Math.trunc(l.screenY), width = Math.trunc(l.width);
    const fg = (this._focused ? this._focusedTextColor : this._textColor).packed;
    const bg = (this._focused ? this._focusedBackgroundColor : this._backgroundColor).packed;
    // An editor's view fills its viewport with its background first (when it has one).
    if ((bg & 0xff) !== 0) buffer.fillRect(x, y, width, Math.trunc(l.height), bg);
    const empty = this.glyphs.length === 0;
    const shown = empty ? clusters(this._placeholder) : clusters(this.plainText);
    const color = empty ? this._placeholderColor.packed : fg;
    const offset = empty ? 0 : this.scrollX;
    let col = 0, cx = x;
    for (const c of shown) {
      if (c.width === 0) continue;
      if (col < offset) { col += c.width; continue; }
      if (col >= offset + width) break;
      if (cx >= buffer.width) break;
      if (c.width > 1 && (col + c.width > offset + width || cx + c.width > buffer.width)) { cx += c.width; col += c.width; continue; }
      if (buffer.isPointInScissor(cx, y)) buffer.blend(cx, y, c.text === "\t" ? " " : c.text, c.width, color, bg === 0 ? 0 : bg, 0);
      cx += c.width; col += c.width;
    }
    if (this._focused && this._showCursor && this._ctx.currentFocusedRenderable === this) {
      const visual = (empty ? 0 : this.cursorColumn()) - offset;
      this._ctx.setCursorStyle({ style: "block", blinking: true, color: this._cursorColor });
      this._ctx.setCursorPosition(Math.max(1, x + visual + 1), Math.max(1, y + 1), true);
    }
  }
}
