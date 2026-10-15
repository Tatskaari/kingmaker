import { BORDER_CHARS, drawBoxCells, sidesOf, type BorderSides, type BorderStyle, type OptimizedBuffer } from "./buffer.ts";
import { Edge, Gutter, Renderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";

/**
 * A box (@opentui/core's Box.ts, painted as scene.zig's paintBox): a background, a border on any
 * of its sides (each one a cell of layout), and a title in the top border.
 */

export type BorderSide = "top" | "right" | "bottom" | "left";

export interface BoxOptions<T = BoxRenderable> extends RenderableOptions<T> {
  backgroundColor?: ColorInput;
  borderStyle?: BorderStyle;
  border?: boolean | BorderSide[];
  borderColor?: ColorInput;
  shouldFill?: boolean;
  title?: string;
  titleColor?: ColorInput;
  titleAlignment?: "left" | "center" | "right";
  bottomTitle?: string;
  bottomTitleAlignment?: "left" | "center" | "right";
  focusedBorderColor?: ColorInput;
  gap?: number | `${number}%`;
  rowGap?: number | `${number}%`;
  columnGap?: number | `${number}%`;
}

const validStyle = (v: unknown): v is BorderStyle => v === "single" || v === "double" || v === "rounded" || v === "heavy";
const isGap = (v: unknown) => v === undefined || (typeof v === "number" && !Number.isNaN(v)) || (typeof v === "string" && v.endsWith("%"));

export class BoxRenderable extends Renderable {
  protected _backgroundColor: RGBA;
  protected _border: boolean | BorderSide[];
  protected _borderStyle: BorderStyle;
  protected _borderColor: RGBA;
  protected _focusedBorderColor: RGBA;
  protected borderSides: BorderSides;
  protected _shouldFill: boolean;
  protected _title: string | undefined;
  protected _titleColor: RGBA | undefined;
  protected _titleAlignment: "left" | "center" | "right";
  protected _bottomTitle: string | undefined;
  protected _bottomTitleAlignment: "left" | "center" | "right";

  constructor(ctx: RenderContext, options: BoxOptions<any>) {
    super(ctx, options);
    if (options.focusable === true) this._focusable = true;
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor || "transparent"));
    this._border = options.border ?? false;
    if (!options.border && (options.borderStyle || options.borderColor || options.focusedBorderColor)) this._border = true;
    this._borderStyle = validStyle(options.borderStyle) ? options.borderStyle : "single";
    this._borderColor = RGBA.clone(parseColor(options.borderColor || "#FFFFFF"));
    if (Array.isArray(this._border)) this._border = [...this._border];
    this._focusedBorderColor = RGBA.clone(parseColor(options.focusedBorderColor || "#00AAFF"));
    this.borderSides = sidesOf(this._border);
    this._shouldFill = options.shouldFill ?? true;
    this._title = options.title;
    this._titleColor = options.titleColor ? RGBA.clone(parseColor(options.titleColor)) : undefined;
    this._titleAlignment = options.titleAlignment || "left";
    this._bottomTitle = options.bottomTitle;
    this._bottomTitleAlignment = options.bottomTitleAlignment || "left";
    this.applyBorderLayout();
    if (options.gap !== undefined || options.rowGap !== undefined || options.columnGap !== undefined) {
      if (isGap(options.gap)) this.yogaNode.setGap(Gutter.All, options.gap);
      if (isGap(options.rowGap)) this.yogaNode.setGap(Gutter.Row, options.rowGap);
      if (isGap(options.columnGap)) this.yogaNode.setGap(Gutter.Column, options.columnGap);
    }
  }

  /** Each side with a border is a cell of Yoga border. */
  private applyBorderLayout(): void {
    const s = this.borderSides;
    this.yogaNode.setBorder(Edge.Left, s.left ? 1 : 0);
    this.yogaNode.setBorder(Edge.Top, s.top ? 1 : 0);
    this.yogaNode.setBorder(Edge.Right, s.right ? 1 : 0);
    this.yogaNode.setBorder(Edge.Bottom, s.bottom ? 1 : 0);
    this.borderSidesForLayout = { ...s };
  }

  private initializeBorder(): void {
    if (this._border === false) {
      this._border = true;
      this.borderSides = sidesOf(true);
      this.applyBorderLayout();
      this.layoutChanged();
    }
  }

  get backgroundColor(): RGBA { return RGBA.clone(this._backgroundColor); }
  set backgroundColor(value: ColorInput | undefined) {
    this._backgroundColor = RGBA.clone(parseColor(value ?? "transparent"));
    this.requestRender();
  }

  get border(): boolean | BorderSide[] { return Array.isArray(this._border) ? [...this._border] : this._border; }
  set border(value: boolean | BorderSide[]) {
    if (this._border === value) return;
    this._border = Array.isArray(value) ? [...value] : value;
    this.borderSides = sidesOf(value);
    this.applyBorderLayout();
    this.layoutChanged();
  }

  get borderStyle(): BorderStyle { return this._borderStyle; }
  set borderStyle(value: BorderStyle) {
    const v = validStyle(value) ? value : "single";
    if (this._borderStyle !== v || !this._border) {
      this._borderStyle = v;
      this.initializeBorder();
      this.requestRender();
    }
  }

  get borderColor(): RGBA { return RGBA.clone(this._borderColor); }
  set borderColor(value: ColorInput) {
    this._borderColor = RGBA.clone(parseColor(value ?? "#FFFFFF"));
    this.initializeBorder();
    this.requestRender();
  }

  get focusedBorderColor(): RGBA { return RGBA.clone(this._focusedBorderColor); }
  set focusedBorderColor(value: ColorInput) {
    this._focusedBorderColor = RGBA.clone(parseColor(value ?? "#00AAFF"));
    this.initializeBorder();
    this.requestRender();
  }

  get title(): string | undefined { return this._title; }
  set title(value: string | undefined) { if (this._title !== value) { this._title = value; this.requestRender(); } }
  get titleColor(): RGBA | undefined { return this._titleColor ? RGBA.clone(this._titleColor) : undefined; }
  set titleColor(value: ColorInput | undefined) { this._titleColor = value ? RGBA.clone(parseColor(value)) : undefined; this.requestRender(); }
  get titleAlignment(): "left" | "center" | "right" { return this._titleAlignment; }
  set titleAlignment(value: "left" | "center" | "right") { this._titleAlignment = value ?? "left"; this.requestRender(); }
  get bottomTitle(): string | undefined { return this._bottomTitle; }
  set bottomTitle(value: string | undefined) { this._bottomTitle = value; this.requestRender(); }
  set bottomTitleAlignment(value: "left" | "center" | "right") { this._bottomTitleAlignment = value ?? "left"; this.requestRender(); }
  get shouldFill(): boolean { return this._shouldFill; }
  set shouldFill(value: boolean) { this._shouldFill = value ?? true; this.requestRender(); }

  set gap(value: number | `${number}%` | undefined) { if (isGap(value)) this.setGap(Gutter.All, value); }
  set rowGap(value: number | `${number}%` | undefined) { if (isGap(value)) this.setGap(Gutter.Row, value); }
  set columnGap(value: number | `${number}%` | undefined) { if (isGap(value)) this.setGap(Gutter.Column, value); }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const s = this.borderSides;
    const hasBorder = s.top || s.right || s.bottom || s.left;
    if (!hasBorder && !(this._shouldFill && this._backgroundColor.a > 0)) return;
    const focusWithin = this._focusable && (this._focused || this._hasFocusedDescendant);
    const borderColor = focusWithin ? this._focusedBorderColor : this._borderColor;
    const l = this._layout;
    drawBoxCells(buffer, Math.trunc(l.screenX), Math.trunc(l.screenY), Math.trunc(l.width), Math.trunc(l.height), BORDER_CHARS[this._borderStyle], s,
      borderColor.packed, this._backgroundColor.packed, (this._titleColor ?? borderColor).packed, this._shouldFill,
      this._title, this._titleAlignment, this._bottomTitle, this._bottomTitleAlignment);
  }
}
