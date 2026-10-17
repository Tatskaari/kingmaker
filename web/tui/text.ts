// Copied from the prototype's src/web/tui/text.ts at 44c6d4a, whole, unchanged.
import type { OptimizedBuffer } from "./buffer.ts";
import { BaseRenderable, MeasureMode, PositionType, Renderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";
import { drawLines, logicalLines, measure, wrapLines, type Glyph, type StyledChunk, type TextAlign, type TextLine, type WrapMode } from "./text-layout.ts";

/**
 * Text (@opentui/core's Text.ts, TextNode.ts and TextBufferRenderable.ts): a <text> gathers its
 * spans into styled chunks (each inheriting the colours and attributes of the spans around it),
 * measures itself for Yoga as the native text view does (no wrapping when the width is free;
 * otherwise wrapped to it, and no more than it offers), and draws the lines that fit its box.
 */

export interface TextChunk { __isChunk?: true; text: string; fg?: RGBA | undefined; bg?: RGBA | undefined; attributes?: number; link?: { url: string } | undefined }

interface Style { fg?: RGBA | undefined; bg?: RGBA | undefined; attributes: number; link?: { url: string } | undefined }

const BrandedTextNode = Symbol.for("@opentui/core/TextNodeRenderable");
export const isTextNodeRenderable = (obj: unknown): obj is TextNodeRenderable => !!(obj as Record<symbol, unknown> | null)?.[BrandedTextNode];

export interface TextNodeOptions { id?: string; fg?: ColorInput; bg?: ColorInput; attributes?: number; link?: { url: string } }

export class TextNodeRenderable extends BaseRenderable {
  [BrandedTextNode] = true;
  private _fg: RGBA | undefined;
  private _bg: RGBA | undefined;
  private _attributes: number;
  private _link: { url: string } | undefined;
  private _children: Array<string | TextNodeRenderable> = [];
  override parent: TextNodeRenderable | null = null;

  constructor(options: TextNodeOptions) {
    super(options);
    this._fg = options.fg ? RGBA.clone(parseColor(options.fg)) : undefined;
    this._bg = options.bg ? RGBA.clone(parseColor(options.bg)) : undefined;
    this._attributes = options.attributes ?? 0;
    this._link = options.link;
  }

  get children(): Array<string | TextNodeRenderable> { return this._children; }
  set children(children: Array<string | TextNodeRenderable>) {
    for (const child of this._children) if (isTextNodeRenderable(child) && child.parent === this) child.parent = null;
    for (const child of children) {
      if (isTextNodeRenderable(child)) {
        if (child.parent && child.parent !== this) child.parent.remove(child);
        child.parent = this;
      }
    }
    this._children = children;
    this.requestRender();
  }

  requestRender(): void {
    this.markDirty();
    this.parent?.requestRender();
  }

  add(obj: TextNodeRenderable | string, index?: number): number {
    if (typeof obj === "string") {
      const at = index ?? this._children.length;
      this._children.splice(at, 0, obj);
      this.requestRender();
      return at;
    }
    if (obj.parent && obj.parent !== this) obj.parent.remove(obj);
    else if (obj.parent === this) {
      const current = this._children.indexOf(obj);
      if (current >= 0) { this._children.splice(current, 1); if (index !== undefined && current < index) index--; }
    }
    const at = Math.max(0, Math.min(index ?? this._children.length, this._children.length));
    this._children.splice(at, 0, obj);
    obj.parent = this;
    this.requestRender();
    return at;
  }

  insertBefore(child: TextNodeRenderable | string, anchor: unknown): this {
    if (!isTextNodeRenderable(anchor)) throw new Error("Anchor must be a TextNodeRenderable");
    const at = this._children.indexOf(anchor);
    if (at < 0) throw new Error("Anchor node not found in children");
    if (child === anchor) return this;
    if (typeof child === "string") { this._children.splice(at, 0, child); this.requestRender(); }
    else this.add(child, at);
    return this;
  }

  remove(child: BaseRenderable): void {
    const at = this._children.indexOf(child as TextNodeRenderable);
    if (at < 0) return;
    this._children.splice(at, 1);
    (child as TextNodeRenderable).parent = null;
    this.requestRender();
  }

  clear(): void {
    for (const child of this._children) if (isTextNodeRenderable(child) && child.parent === this) child.parent = null;
    this._children = [];
    this.requestRender();
  }

  gatherWithInheritedStyle(parent: Style = { attributes: 0 }): TextChunk[] {
    const style: Style = { fg: this._fg ?? parent.fg, bg: this._bg ?? parent.bg, attributes: this._attributes | parent.attributes, link: this._link ?? parent.link };
    const chunks: TextChunk[] = [];
    for (const child of this._children) {
      if (typeof child === "string") chunks.push({ __isChunk: true, text: child, fg: style.fg, bg: style.bg, attributes: style.attributes, link: style.link });
      else chunks.push(...child.gatherWithInheritedStyle(style));
    }
    this.markClean();
    return chunks;
  }

  getChildren(): BaseRenderable[] { return this._children.filter((c): c is TextNodeRenderable => typeof c !== "string"); }
  getChildrenCount(): number { return this._children.length; }

  get fg(): RGBA | undefined { return this._fg ? RGBA.clone(this._fg) : undefined; }
  set fg(value: ColorInput | undefined) { this._fg = value ? RGBA.clone(parseColor(value)) : undefined; this.requestRender(); }
  get bg(): RGBA | undefined { return this._bg ? RGBA.clone(this._bg) : undefined; }
  set bg(value: ColorInput | undefined) { this._bg = value ? RGBA.clone(parseColor(value)) : undefined; this.requestRender(); }
  get attributes(): number { return this._attributes; }
  set attributes(value: number) { this._attributes = value ?? 0; this.requestRender(); }
  get link(): { url: string } | undefined { return this._link; }
  set link(value: { url: string } | undefined) { this._link = value; this.requestRender(); }

  static fromString(text: string, options: Partial<TextNodeOptions> = {}): TextNodeRenderable {
    const node = new TextNodeRenderable(options);
    node.add(text);
    return node;
  }

  findDescendantById(_id: string): BaseRenderable | undefined { return undefined; }
}

export class RootTextNodeRenderable extends TextNodeRenderable {
  readonly textParent: TextBufferRenderable;
  constructor(options: TextNodeOptions, textParent: TextBufferRenderable) { super(options); this.textParent = textParent; }
  override requestRender(): void {
    this.markDirty();
    this.textParent.requestRender();
  }
}

export interface TextBufferOptions extends RenderableOptions<any> {
  fg?: ColorInput;
  bg?: ColorInput;
  attributes?: number;
  wrapMode?: WrapMode;
  textAlign?: TextAlign;
  truncate?: boolean;
  selectable?: boolean;
}

/** What TextRenderable and the input share: styled chunks, laid out and drawn as the native text view does. */
export abstract class TextBufferRenderable extends Renderable {
  protected _defaultFg: RGBA;
  protected _defaultBg: RGBA;
  protected _defaultAttributes: number;
  protected _wrapMode: WrapMode;
  protected _textAlign: TextAlign;
  protected _truncate: boolean;
  protected _scrollX = 0;
  protected _scrollY = 0;
  private logical: Glyph[][] = [[]];
  private wrapped: { width: number; mode: WrapMode; lines: TextLine[] } | undefined;
  private plain = "";

  constructor(ctx: RenderContext, options: TextBufferOptions) {
    super(ctx, options);
    this._defaultFg = RGBA.clone(parseColor(options.fg ?? RGBA.fromValues(1, 1, 1, 1)));
    this._defaultBg = RGBA.clone(parseColor(options.bg ?? RGBA.fromValues(0, 0, 0, 0)));
    this._defaultAttributes = options.attributes ?? 0;
    this._wrapMode = options.wrapMode ?? "word";
    this._textAlign = options.textAlign ?? "left";
    this._truncate = options.truncate ?? false;
    this.selectable = options.selectable ?? true;
    this.yogaNode.setMeasureFunc((width, widthMode, height, _heightMode) => this.measureFor(width, widthMode, height));
  }

  /** The native measure (NativeRenderable.measure): unconstrained, the text's own size; at most a width, wrapped to it and no bigger. */
  private measureFor(width: number, widthMode: MeasureMode, height: number): { width: number; height: number } {
    const effectiveWidth = widthMode === MeasureMode.Undefined || Number.isNaN(width) ? 0 : width;
    const effectiveHeight = Number.isNaN(height) ? 1 : height;
    const measureWidth = !Number.isFinite(effectiveWidth) || effectiveWidth <= 0 ? 0 : Math.floor(effectiveWidth);
    const result = measure(this.logical, this._wrapMode, measureWidth);
    let w = Math.max(1, result.maxWidth);
    let h = Math.max(1, result.lineCount);
    if (widthMode === MeasureMode.AtMost && this.yogaNode.getPositionType() !== PositionType.Absolute) {
      w = Math.min(effectiveWidth, w);
      h = Math.min(effectiveHeight, h);
    }
    return { width: w, height: h };
  }

  /** New content: re-measure. */
  protected setChunks(chunks: StyledChunk[]): void {
    this.logical = logicalLines(chunks);
    this.plain = chunks.map(c => c.text).join("");
    this.wrapped = undefined;
    this.yogaNode.markDirty();
    this.layoutChanged();
  }

  get plainText(): string { return this.plain; }

  protected linesFor(width: number): TextLine[] {
    const mode = this._wrapMode;
    if (this.wrapped && this.wrapped.width === width && this.wrapped.mode === mode) return this.wrapped.lines;
    const lines = wrapLines(this.logical, mode, mode === "none" ? undefined : width);
    this.wrapped = { width, mode, lines };
    return lines;
  }

  get lineCount(): number { return this.logical.length; }
  get virtualLineCount(): number { return this.linesFor(Math.trunc(this.width)).length; }
  get scrollHeight(): number { return this.virtualLineCount; }
  get scrollWidth(): number { return this.linesFor(Math.trunc(this.width)).reduce((n, l) => Math.max(n, l.width), 0); }
  get scrollY(): number { return this._scrollY; }
  set scrollY(value: number) {
    const clamped = Math.max(0, Math.min(value ?? 0, Math.max(0, this.scrollHeight - this.height)));
    if (clamped !== this._scrollY) { this._scrollY = clamped; this.requestRender(); }
  }
  get scrollX(): number { return this._scrollX; }
  set scrollX(value: number) {
    const clamped = Math.max(0, Math.min(value ?? 0, Math.max(0, this.scrollWidth - this.width)));
    if (clamped !== this._scrollX) { this._scrollX = clamped; this.requestRender(); }
  }

  protected abstract recompose(): void;

  get fg(): RGBA { return RGBA.clone(this._defaultFg); }
  set fg(value: ColorInput | undefined) { this._defaultFg = RGBA.clone(parseColor(value ?? RGBA.fromValues(1, 1, 1, 1))); this.onStyleChanged(); }
  get bg(): RGBA { return RGBA.clone(this._defaultBg); }
  set bg(value: ColorInput | undefined) { this._defaultBg = RGBA.clone(parseColor(value ?? RGBA.fromValues(0, 0, 0, 0))); this.onStyleChanged(); }
  get attributes(): number { return this._defaultAttributes; }
  set attributes(value: number | undefined) {
    const v = value ?? 0;
    if (this._defaultAttributes !== v) { this._defaultAttributes = v; this.onStyleChanged(); }
  }
  get wrapMode(): WrapMode { return this._wrapMode; }
  set wrapMode(value: WrapMode) {
    const v = value ?? "word";
    if (this._wrapMode !== v) { this._wrapMode = v; this.wrapped = undefined; this.yogaNode.markDirty(); this.layoutChanged(); }
  }
  get textAlign(): TextAlign { return this._textAlign; }
  set textAlign(value: TextAlign) { this._textAlign = value ?? "left"; this.requestRender(); }
  get truncate(): boolean { return this._truncate; }
  set truncate(value: boolean) { this._truncate = value ?? false; this.requestRender(); }

  protected onStyleChanged(): void { this.recompose(); }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const l = this._layout;
    const width = Math.trunc(l.width), height = Math.trunc(l.height);
    const lines = this.linesFor(width);
    drawLines(buffer, lines, Math.trunc(l.screenX), Math.trunc(l.screenY), { x: Math.trunc(this._scrollX), y: Math.trunc(this._scrollY), width, height }, this._textAlign);
  }

  protected override onMouseEvent(event: { type: string; scroll?: { direction: string; delta: number } | undefined }): void {
    if (event.type !== "scroll" || !event.scroll) return;
    const { direction, delta } = event.scroll;
    if (direction === "up") this.scrollY -= delta;
    else if (direction === "down") this.scrollY += delta;
    if (this._wrapMode === "none") {
      if (direction === "left") this.scrollX -= delta;
      else if (direction === "right") this.scrollX += delta;
    }
  }
}

export interface TextOptions extends TextBufferOptions { content?: string }

export class TextRenderable extends TextBufferRenderable {
  protected rootTextNode: RootTextNodeRenderable | undefined;
  private manual = false;

  constructor(ctx: RenderContext, options: TextOptions) {
    super(ctx, options);
    if (options.content !== undefined && options.content !== "") { this.manual = true; this.content = options.content; }
    else this.setChunks([]);
    this.onLifecyclePass = () => { if (this.rootTextNode?.isDirty && !this.manual) this.recompose(); };
  }

  get textNode(): RootTextNodeRenderable {
    return (this.rootTextNode ??= new RootTextNodeRenderable({ id: `${this.id}-root`, fg: this._defaultFg, bg: this._defaultBg, attributes: this._defaultAttributes }, this));
  }

  set content(value: string) {
    this.manual = true;
    this.setChunks([{ text: value, fg: this._defaultFg.packed, bg: this._defaultBg.packed, attrs: this._defaultAttributes }]);
  }

  get chunks(): TextChunk[] { return this.rootTextNode?.gatherWithInheritedStyle({ fg: this._defaultFg, bg: this._defaultBg, attributes: this._defaultAttributes }) ?? []; }

  protected recompose(): void {
    if (this.manual) return;
    const chunks = this.rootTextNode
      ? this.rootTextNode.gatherWithInheritedStyle({ fg: this._defaultFg, bg: this._defaultBg, attributes: this._defaultAttributes })
      : [];
    this.setChunks(chunks.map(c => ({ text: c.text, fg: (c.fg ?? this._defaultFg).packed, bg: (c.bg ?? this._defaultBg).packed, attrs: c.attributes ?? 0 })));
  }

  protected override onStyleChanged(): void {
    if (this.rootTextNode) {
      this.rootTextNode.fg = this._defaultFg;
      this.rootTextNode.bg = this._defaultBg;
      this.rootTextNode.attributes = this._defaultAttributes;
    }
    this.recompose();
  }

  override add(obj: TextNodeRenderable | string | Renderable | null | undefined, index?: number): number {
    if (obj === null || obj === undefined) return -1;
    if (obj instanceof Renderable) throw new Error("A <text> holds spans and strings, not other renderables.");
    this.manual = false;
    return this.textNode.add(obj, index);
  }

  override insertBefore(obj: TextNodeRenderable | Renderable | string | null | undefined, anchor?: unknown): number {
    if (obj === null || obj === undefined) return -1;
    if (obj instanceof Renderable) throw new Error("A <text> holds spans and strings, not other renderables.");
    this.manual = false;
    this.textNode.insertBefore(obj, anchor);
    return this.textNode.children.indexOf(obj);
  }

  override remove(child: BaseRenderable): void {
    if (child instanceof Renderable) { super.remove(child); return; }
    this.textNode.remove(child);
  }

  getTextChildren(): BaseRenderable[] { return this.rootTextNode?.getChildren() ?? []; }

  clear(): void {
    this.rootTextNode?.clear();
    this.setChunks([]);
  }
}
