import { Align, Direction, Display, Edge, FlexDirection, Gutter, Justify, MeasureMode, Overflow, PositionType, Wrap, loadYoga } from "yoga-layout/load";
import type { Config as YogaConfig, Node as YogaNode } from "yoga-layout/load";
import type { OptimizedBuffer } from "./buffer.ts";
import { EventEmitter, type KeyEvent, type KeyHandler, type MouseEvent, type PasteEvent } from "./events.ts";

/**
 * Renderables as OpenTUI has them (@opentui/core's Renderable.ts, MIT), laid out by Yoga (the same
 * Yoga 3.2.1 OpenTUI's native scene embeds, with its config: no web defaults, a point scale of 1)
 * and painted the way the native scene paints them (packages/native/src/scene.zig): parents before
 * children, siblings by zIndex then order, children of an overflow-hidden box clipped to inside
 * its border, every node at least one cell, and each one added to the hit grid as it's painted.
 */

type Yoga = Awaited<ReturnType<typeof loadYoga>>;
let yoga: Yoga | undefined;
let yogaConfig: YogaConfig | undefined;

/** Load Yoga's WebAssembly (once; renderers do before anything is made). */
export async function initLayout(): Promise<void> {
  if (yoga) return;
  yoga = await loadYoga();
  yogaConfig = yoga.Config.create();
  yogaConfig.setUseWebDefaults(false);
  yogaConfig.setPointScaleFactor(1);
}

function newNode(): YogaNode {
  if (!yoga || !yogaConfig) throw new Error("Layout isn't loaded: create the renderer first (createCliRenderer).");
  return yoga.Node.create(yogaConfig);
}

export { MeasureMode };

/** What a renderable needs of its renderer. */
export interface RenderContext extends EventEmitter {
  width: number;
  height: number;
  widthMethod: string;
  requestRender(): void;
  requestLive(): void;
  dropLive(): void;
  focusRenderable(renderable: Renderable): void;
  blurRenderable(renderable: Renderable): void;
  readonly currentFocusedRenderable: Renderable | null;
  readonly keyInput: KeyHandler;
  readonly _internalKeyInput: KeyHandler;
  setCursorPosition(x: number, y: number, visible?: boolean): void;
  setCursorStyle(options: { style?: string; blinking?: boolean; color?: unknown }): void;
  getSelection(): null;
  layoutChanged(): void;
}

export type DimensionValue = number | "auto" | `${number}%`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface RenderableOptions<_T = unknown> {
  id?: string;
  width?: DimensionValue;
  height?: DimensionValue;
  minWidth?: number | `${number}%`;
  minHeight?: number | `${number}%`;
  maxWidth?: number | `${number}%`;
  maxHeight?: number | `${number}%`;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | "auto";
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "no-wrap" | "wrap" | "wrap-reverse";
  alignItems?: string;
  justifyContent?: string;
  alignSelf?: string;
  position?: "relative" | "absolute";
  overflow?: "visible" | "hidden" | "scroll";
  top?: number | "auto" | `${number}%`;
  right?: number | "auto" | `${number}%`;
  bottom?: number | "auto" | `${number}%`;
  left?: number | "auto" | `${number}%`;
  margin?: number | "auto" | `${number}%`;
  marginX?: number | "auto" | `${number}%`;
  marginY?: number | "auto" | `${number}%`;
  marginTop?: number | "auto" | `${number}%`;
  marginRight?: number | "auto" | `${number}%`;
  marginBottom?: number | "auto" | `${number}%`;
  marginLeft?: number | "auto" | `${number}%`;
  padding?: number | `${number}%`;
  paddingX?: number | `${number}%`;
  paddingY?: number | `${number}%`;
  paddingTop?: number | `${number}%`;
  paddingRight?: number | `${number}%`;
  paddingBottom?: number | `${number}%`;
  paddingLeft?: number | `${number}%`;
  zIndex?: number;
  visible?: boolean;
  live?: boolean;
  focusable?: boolean;
  onMouse?: (event: MouseEvent) => void;
  onMouseDown?: (event: MouseEvent) => void;
  onMouseUp?: (event: MouseEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onMouseDrag?: (event: MouseEvent) => void;
  onMouseDragEnd?: (event: MouseEvent) => void;
  onMouseDrop?: (event: MouseEvent) => void;
  onMouseOver?: (event: MouseEvent) => void;
  onMouseOut?: (event: MouseEvent) => void;
  onMouseScroll?: (event: MouseEvent) => void;
  onKeyDown?: (key: KeyEvent) => void;
  onSizeChange?: () => void;
  [key: string]: unknown;
}

const isPercent = (v: unknown): v is `${number}%` => typeof v === "string" && v.endsWith("%") && !Number.isNaN(parseFloat(v));
const isNumber = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
const isMargin = (v: unknown) => isNumber(v) || v === "auto" || isPercent(v);
const isPadding = (v: unknown) => isNumber(v) || isPercent(v);
const isPosition = (v: unknown) => isNumber(v) || v === "auto" || isPercent(v);
const isDimension = isPosition;
const isSize = (v: unknown) => v === undefined || isNumber(v) || isPercent(v);
const isFlexBasis = (v: unknown) => v === undefined || v === "auto" || isNumber(v);

function parseAlign(value: string | null | undefined, fallback: Align): Align {
  switch (value?.toLowerCase()) {
    case "auto": return Align.Auto;
    case "flex-start": return Align.FlexStart;
    case "center": return Align.Center;
    case "flex-end": return Align.FlexEnd;
    case "stretch": return Align.Stretch;
    case "baseline": return Align.Baseline;
    case "space-between": return Align.SpaceBetween;
    case "space-around": return Align.SpaceAround;
    case "space-evenly": return Align.SpaceEvenly;
    default: return fallback;
  }
}

function parseJustify(value: string | null | undefined): Justify {
  switch (value?.toLowerCase()) {
    case "center": return Justify.Center;
    case "flex-end": return Justify.FlexEnd;
    case "space-between": return Justify.SpaceBetween;
    case "space-around": return Justify.SpaceAround;
    case "space-evenly": return Justify.SpaceEvenly;
    default: return Justify.FlexStart;
  }
}

function parseFlexDirection(value: string | null | undefined): FlexDirection {
  switch (value?.toLowerCase()) {
    case "row": return FlexDirection.Row;
    case "row-reverse": return FlexDirection.RowReverse;
    case "column-reverse": return FlexDirection.ColumnReverse;
    default: return FlexDirection.Column;
  }
}

function parseWrap(value: string | null | undefined): Wrap {
  switch (value?.toLowerCase()) {
    case "wrap": return Wrap.Wrap;
    case "wrap-reverse": return Wrap.WrapReverse;
    default: return Wrap.NoWrap;
  }
}

export interface Layout { left: number; top: number; width: number; height: number; screenX: number; screenY: number }

export class BaseRenderable extends EventEmitter {
  static renderableNumber = 1;
  readonly num: number;
  protected _id: string;
  parent: BaseRenderable | null = null;
  protected _dirty = false;
  protected _visible = true;

  constructor(options: { id?: string }) {
    super();
    this.num = BaseRenderable.renderableNumber++;
    this._id = options.id ?? `renderable-${this.num}`;
  }

  get id(): string { return this._id; }
  set id(value: string) { this._id = value; }
  get isDirty(): boolean { return this._dirty; }
  markClean(): void { this._dirty = false; }
  markDirty(): void { this._dirty = true; }
  destroy(): void {}
  destroyRecursively(): void {}
  get visible(): boolean { return this._visible; }
  set visible(value: boolean) { this._visible = value; }
}

const BrandedRenderable = Symbol.for("@opentui/core/Renderable");
export const isRenderable = (obj: unknown): obj is Renderable => !!(obj as Record<symbol, unknown> | null)?.[BrandedRenderable];

export class Renderable extends BaseRenderable {
  [BrandedRenderable] = true;
  static renderablesByNumber = new Map<number, Renderable>();
  protected static readonly defaultFocusable: boolean = false;

  readonly yogaNode: YogaNode;
  protected _ctx: RenderContext;
  override parent: Renderable | null = null;
  /** Children in layout order (as added). */
  protected _childrenInLayoutOrder: Renderable[] = [];
  protected _isDestroyed = false;
  protected _width: DimensionValue;
  protected _height: DimensionValue;
  protected _zIndex: number;
  protected _live: boolean;
  _liveCount: number;
  protected _focusable: boolean;
  protected _focused = false;
  protected _hasFocusedDescendant = false;
  protected _positionType: "relative" | "absolute" = "relative";
  protected _overflow: "visible" | "hidden" | "scroll" = "visible";
  protected _position: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown } = {};
  protected _flexShrink = 1;
  protected _translateX = 0;
  protected _translateY = 0;
  protected _opacity = 1;
  /**
   * The layout as the node's own getters see it (the native scene's observed layout): it changes
   * when the frame's resize pass reaches this node, so a resize hook sees the new size of nodes
   * above it and the old size of nodes below it, as OpenTUI's do.
   */
  _layout: Layout = { left: 0, top: 0, width: 0, height: 0, screenX: 0, screenY: 0 };
  /** The layout just computed for this frame, before the resize pass reaches the node. */
  _next: Layout = { left: 0, top: 0, width: 0, height: 0, screenX: 0, screenY: 0 };
  /** Size as last reported to onResize / onSizeChange. */
  _reportedSize: { width: number; height: number } | undefined;
  protected keypressHandler: ((key: KeyEvent) => void) | null = null;
  protected pasteHandler: ((event: PasteEvent) => void) | null = null;
  protected _mouseListener: ((event: MouseEvent) => void) | null = null;
  protected _mouseListeners: Partial<Record<string, (event: MouseEvent) => void>> = {};
  protected _keyListeners: Partial<Record<string, (key: KeyEvent) => void>> = {};
  protected _pasteListener: ((event: PasteEvent) => void) | undefined;
  private _sizeChangeListener: (() => void) | undefined;
  /** Paint borders (Box): they're layout too (one cell a side). */
  protected borderSidesForLayout = { top: false, right: false, bottom: false, left: false };
  /** Called before layout each frame when it returns true (Text composes its spans). */
  onLifecyclePass: (() => void) | null = null;
  selectable = false;
  renderBefore?: (buffer: OptimizedBuffer, deltaTime: number) => void;
  renderAfter?: (buffer: OptimizedBuffer, deltaTime: number) => void;

  constructor(ctx: RenderContext, options: RenderableOptions<any>) {
    super(options);
    this._ctx = ctx;
    this.yogaNode = newNode();
    Renderable.renderablesByNumber.set(this.num, this);
    if (typeof options.width === "number" && options.width < 0) throw new TypeError(`Invalid width for Renderable ${this.id}: ${options.width}`);
    if (typeof options.height === "number" && options.height < 0) throw new TypeError(`Invalid height for Renderable ${this.id}: ${options.height}`);
    this._width = options.width ?? "auto";
    this._height = options.height ?? "auto";
    this._zIndex = options.zIndex ?? 0;
    this._visible = options.visible !== false;
    this._live = options.live ?? false;
    this._liveCount = this._live && this._visible ? 1 : 0;
    this._focusable = options.focusable ?? (this.constructor as typeof Renderable).defaultFocusable;
    this.yogaNode.setDisplay(this._visible ? Display.Flex : Display.None);
    this.setupYogaProperties(options);
    this.applyEventOptions(options);
  }

  get ctx(): RenderContext { return this._ctx; }
  get isDestroyed(): boolean { return this._isDestroyed; }

  // ------------------------------------------------------------------------------------------
  // Layout properties (setupYogaProperties, then the setters)

  private setupYogaProperties(options: RenderableOptions): void {
    const node = this.yogaNode;
    if (isFlexBasis(options.flexBasis)) node.setFlexBasis(options.flexBasis);
    if (isSize(options.minWidth)) node.setMinWidth(options.minWidth);
    if (isSize(options.minHeight)) node.setMinHeight(options.minHeight);
    node.setFlexGrow(options.flexGrow ?? 0);
    if (options.flexShrink !== undefined) this._flexShrink = options.flexShrink;
    else this._flexShrink = typeof options.width === "number" || typeof options.height === "number" ? 0 : 1;
    node.setFlexShrink(this._flexShrink);
    node.setFlexDirection(parseFlexDirection(options.flexDirection));
    node.setFlexWrap(parseWrap(options.flexWrap));
    node.setAlignItems(parseAlign(options.alignItems, Align.Stretch));
    node.setJustifyContent(parseJustify(options.justifyContent));
    node.setAlignSelf(parseAlign(options.alignSelf, Align.Auto));
    if (isDimension(options.width)) { this._width = options.width!; node.setWidth(options.width as DimensionValue); }
    if (isDimension(options.height)) { this._height = options.height!; node.setHeight(options.height as DimensionValue); }
    this._positionType = options.position === "absolute" ? "absolute" : "relative";
    if (this._positionType !== "relative") node.setPositionType(PositionType.Absolute);
    this._overflow = options.overflow === "hidden" ? "hidden" : options.overflow === "scroll" ? "scroll" : "visible";
    if (this._overflow !== "visible") node.setOverflow(this._overflow === "hidden" ? Overflow.Hidden : Overflow.Scroll);
    if (options.top !== undefined || options.right !== undefined || options.bottom !== undefined || options.left !== undefined) {
      this._position = { top: options.top, right: options.right, bottom: options.bottom, left: options.left };
      this.updateYogaPosition(this._position);
    }
    if (isSize(options.maxWidth)) node.setMaxWidth(options.maxWidth);
    if (isSize(options.maxHeight)) node.setMaxHeight(options.maxHeight);
    const margin = (edge: Edge, v: unknown) => { if (isMargin(v)) node.setMargin(edge, v as number); };
    const padding = (edge: Edge, v: unknown) => { if (isPadding(v)) node.setPadding(edge, v as number); };
    margin(Edge.All, options.margin); margin(Edge.Horizontal, options.marginX); margin(Edge.Vertical, options.marginY);
    margin(Edge.Top, options.marginTop); margin(Edge.Right, options.marginRight); margin(Edge.Bottom, options.marginBottom); margin(Edge.Left, options.marginLeft);
    padding(Edge.All, options.padding); padding(Edge.Horizontal, options.paddingX); padding(Edge.Vertical, options.paddingY);
    padding(Edge.Top, options.paddingTop); padding(Edge.Right, options.paddingRight); padding(Edge.Bottom, options.paddingBottom); padding(Edge.Left, options.paddingLeft);
  }

  private updateYogaPosition(position: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown }): void {
    const set = (edge: Edge, v: unknown) => this.yogaNode.setPosition(edge, isPosition(v) ? (v as number) : undefined);
    set(Edge.Left, position.left); set(Edge.Top, position.top); set(Edge.Right, position.right); set(Edge.Bottom, position.bottom);
  }

  /** A layout property changed: lay out again before the next paint. */
  protected layoutChanged(): void {
    this._ctx.layoutChanged();
    this.requestRender();
  }

  get width(): number {
    const w = this._layout.width;
    return w === 0 ? (typeof this._width === "number" ? this._width : 0) : w;
  }
  set width(value: DimensionValue) {
    if (!isDimension(value) || this._width === value) return;
    const disableShrink = typeof value === "number" && this._flexShrink === 1;
    this.yogaNode.setWidth(value);
    this._width = value;
    if (disableShrink) { this._flexShrink = 0; this.yogaNode.setFlexShrink(0); }
    this.layoutChanged();
  }
  get height(): number {
    const h = this._layout.height;
    return h === 0 ? (typeof this._height === "number" ? this._height : 0) : h;
  }
  set height(value: DimensionValue) {
    if (!isDimension(value) || this._height === value) return;
    const disableShrink = typeof value === "number" && this._flexShrink === 1;
    this.yogaNode.setHeight(value);
    this._height = value;
    if (disableShrink) { this._flexShrink = 0; this.yogaNode.setFlexShrink(0); }
    this.layoutChanged();
  }
  get x(): number { return this._layout.screenX; }
  set x(value: number) { this.left = value; }
  get y(): number { return this._layout.screenY; }
  set y(value: number) { this.top = value; }
  get screenX(): number { return this._layout.screenX; }
  get screenY(): number { return this._layout.screenY; }

  get top(): unknown { return this._position.top; }
  set top(value: unknown) { if (isPosition(value) || value === undefined) this.setPosition({ top: value }); }
  get right(): unknown { return this._position.right; }
  set right(value: unknown) { if (isPosition(value) || value === undefined) this.setPosition({ right: value }); }
  get bottom(): unknown { return this._position.bottom; }
  set bottom(value: unknown) { if (isPosition(value) || value === undefined) this.setPosition({ bottom: value }); }
  get left(): unknown { return this._position.left; }
  set left(value: unknown) { if (isPosition(value) || value === undefined) this.setPosition({ left: value }); }
  setPosition(position: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown }): void {
    this._position = { ...this._position, ...position };
    this.updateYogaPosition(this._position);
    this.layoutChanged();
  }

  set position(value: "relative" | "absolute") {
    if ((value !== "relative" && value !== "absolute") || this._positionType === value) return;
    this.yogaNode.setPositionType(value === "absolute" ? PositionType.Absolute : PositionType.Relative);
    this._positionType = value;
    this.layoutChanged();
  }
  get overflow(): "visible" | "hidden" | "scroll" { return this._overflow; }
  set overflow(value: "visible" | "hidden" | "scroll") {
    if (!["visible", "hidden", "scroll"].includes(value) || this._overflow === value) return;
    this.yogaNode.setOverflow(value === "hidden" ? Overflow.Hidden : value === "scroll" ? Overflow.Scroll : Overflow.Visible);
    this._overflow = value;
    this.layoutChanged();
  }
  set flexGrow(value: number | null | undefined) { this.yogaNode.setFlexGrow(value ?? 0); this.layoutChanged(); }
  set flexShrink(value: number | null | undefined) { const v = value ?? 1; this.yogaNode.setFlexShrink(v); this._flexShrink = v; this.layoutChanged(); }
  set flexDirection(value: string | undefined) { this.yogaNode.setFlexDirection(parseFlexDirection(value)); this.layoutChanged(); }
  set flexWrap(value: string | undefined) { this.yogaNode.setFlexWrap(parseWrap(value)); this.layoutChanged(); }
  set alignItems(value: string | undefined) { this.yogaNode.setAlignItems(parseAlign(value, Align.Stretch)); this.layoutChanged(); }
  set justifyContent(value: string | undefined) { this.yogaNode.setJustifyContent(parseJustify(value)); this.layoutChanged(); }
  set alignSelf(value: string | undefined) { this.yogaNode.setAlignSelf(parseAlign(value, Align.Auto)); this.layoutChanged(); }
  set flexBasis(value: number | "auto" | undefined) { if (isFlexBasis(value)) { this.yogaNode.setFlexBasis(value); this.layoutChanged(); } }
  set minWidth(value: number | `${number}%` | undefined) { if (isSize(value)) { this.yogaNode.setMinWidth(value); this.layoutChanged(); } }
  set maxWidth(value: number | `${number}%` | undefined) { if (isSize(value)) { this.yogaNode.setMaxWidth(value); this.layoutChanged(); } }
  set minHeight(value: number | `${number}%` | undefined) { if (isSize(value)) { this.yogaNode.setMinHeight(value); this.layoutChanged(); } }
  set maxHeight(value: number | `${number}%` | undefined) { if (isSize(value)) { this.yogaNode.setMaxHeight(value); this.layoutChanged(); } }
  private setMarginEdge(edge: Edge, v: unknown): void { if (isMargin(v)) { this.yogaNode.setMargin(edge, v as number); this.layoutChanged(); } }
  private setPaddingEdge(edge: Edge, v: unknown): void { if (isPadding(v)) { this.yogaNode.setPadding(edge, v as number); this.layoutChanged(); } }
  set margin(v: unknown) { this.setMarginEdge(Edge.All, v); }
  set marginX(v: unknown) { this.setMarginEdge(Edge.Horizontal, v); }
  set marginY(v: unknown) { this.setMarginEdge(Edge.Vertical, v); }
  set marginTop(v: unknown) { this.setMarginEdge(Edge.Top, v); }
  set marginRight(v: unknown) { this.setMarginEdge(Edge.Right, v); }
  set marginBottom(v: unknown) { this.setMarginEdge(Edge.Bottom, v); }
  set marginLeft(v: unknown) { this.setMarginEdge(Edge.Left, v); }
  set padding(v: unknown) { this.setPaddingEdge(Edge.All, v); }
  set paddingX(v: unknown) { this.setPaddingEdge(Edge.Horizontal, v); }
  set paddingY(v: unknown) { this.setPaddingEdge(Edge.Vertical, v); }
  set paddingTop(v: unknown) { this.setPaddingEdge(Edge.Top, v); }
  set paddingRight(v: unknown) { this.setPaddingEdge(Edge.Right, v); }
  set paddingBottom(v: unknown) { this.setPaddingEdge(Edge.Bottom, v); }
  set paddingLeft(v: unknown) { this.setPaddingEdge(Edge.Left, v); }
  setGap(gutter: Gutter, value: number | `${number}%` | undefined): void { this.yogaNode.setGap(gutter, value); this.layoutChanged(); }

  get zIndex(): number { return this._zIndex; }
  set zIndex(value: number | undefined) { const v = value ?? 0; if (this._zIndex !== v) { this._zIndex = v; this.requestRender(); } }
  get translateX(): number { return this._translateX; }
  set translateX(value: number) { value ??= 0; if (this._translateX !== value) { this._translateX = value; this.requestRender(); } }
  get translateY(): number { return this._translateY; }
  set translateY(value: number) { value ??= 0; if (this._translateY !== value) { this._translateY = value; this.requestRender(); } }
  get opacity(): number { return this._opacity; }
  set opacity(value: number) { this._opacity = value === undefined ? 1 : Math.max(0, Math.min(1, value)); this.requestRender(); }

  override get visible(): boolean { return this._visible; }
  override set visible(value: boolean) {
    if (this._visible === value) return;
    const was = this._visible;
    this.yogaNode.setDisplay(value ? Display.Flex : Display.None);
    this._visible = value;
    if (this._live) {
      if (!was && value) this.propagateLiveCount(1);
      else if (was && !value) this.propagateLiveCount(-1);
    }
    if (this._focused) this.blur();
    this.layoutChanged();
  }

  get live(): boolean { return this._live; }
  set live(value: boolean | undefined) {
    const v = value ?? false;
    if (this._live === v) return;
    this._live = v;
    if (this._visible) this.propagateLiveCount(v ? 1 : -1);
  }
  get liveCount(): number { return this._liveCount; }
  propagateLiveCount(delta: number): void {
    this._liveCount += delta;
    this.parent?.propagateLiveCount(delta);
  }

  requestRender(): void {
    this.markDirty();
    this._ctx.requestRender();
  }

  // ------------------------------------------------------------------------------------------
  // The tree

  add(child: Renderable | null | undefined, index?: number): number {
    if (!child) return -1;
    if (this._isDestroyed || child.isDestroyed) return -1;
    const anchor = index !== undefined ? this._childrenInLayoutOrder[index] : undefined;
    if (anchor) return this.insertBefore(child, anchor);
    return this.placeChild(child);
  }

  insertBefore(child: Renderable | null | undefined, anchor?: Renderable | unknown): number {
    if (!anchor) return this.add(child);
    if (!child || this._isDestroyed || child.isDestroyed) return -1;
    if (!isRenderable(anchor) || anchor.isDestroyed || child === anchor) return -1;
    if (!this._childrenInLayoutOrder.includes(anchor)) return -1;
    return this.placeChild(child, anchor);
  }

  private placeChild(child: Renderable, anchor?: Renderable): number {
    const previous = child.parent;
    if (previous && previous !== this) previous.remove(child);
    else if (previous === this) {
      const at = this._childrenInLayoutOrder.indexOf(child);
      if (at >= 0) { this._childrenInLayoutOrder.splice(at, 1); this.yogaNode.removeChild(child.yogaNode); }
    }
    const index = anchor ? this._childrenInLayoutOrder.indexOf(anchor) : this._childrenInLayoutOrder.length;
    if (index < 0) return -1;
    this._childrenInLayoutOrder.splice(index, 0, child);
    this.yogaNode.insertChild(child.yogaNode, index);
    const moving = child.parent !== this;
    child.parent = this;
    if (moving && child._liveCount > 0) this.propagateLiveCount(child._liveCount);
    if (moving && (child._focused || child._hasFocusedDescendant)) child.propagateFocusChange(true);
    this.layoutChanged();
    return index;
  }

  remove(child: Renderable): void {
    const index = this._childrenInLayoutOrder.indexOf(child);
    if (index < 0) return;
    this._childrenInLayoutOrder.splice(index, 1);
    this.yogaNode.removeChild(child.yogaNode);
    if (child._focused || child._hasFocusedDescendant) child.propagateFocusChange(false);
    if (child._liveCount > 0) this.propagateLiveCount(-child._liveCount);
    child.parent = null;
    child.onRemove();
    this.layoutChanged();
  }

  onRemove(): void {}
  getChildren(): Renderable[] { return [...this._childrenInLayoutOrder]; }
  /** The children themselves (the renderer's walk), not a copy. */
  getChildrenInternal(): readonly Renderable[] { return this._childrenInLayoutOrder; }
  getChildrenCount(): number { return this._childrenInLayoutOrder.length; }
  getRenderable(id: string): Renderable | undefined { return this._childrenInLayoutOrder.find(c => c.id === id); }
  findDescendantById(id: string): Renderable | undefined {
    for (const child of this._childrenInLayoutOrder) {
      if (child.id === id) return child;
      const found = child.findDescendantById(id);
      if (found) return found;
    }
    return undefined;
  }

  override destroy(): void {
    if (this._isDestroyed) return;
    if (this._focused) this.blur();
    if (this.parent) this.parent.remove(this);
    this._isDestroyed = true;
    this.destroySelf();
    Renderable.renderablesByNumber.delete(this.num);
    // The node's children go with their own destroy; detach them from this node first.
    for (const child of this._childrenInLayoutOrder) this.yogaNode.removeChild(child.yogaNode);
    this.yogaNode.free();
    this.emit("destroyed");
  }

  override destroyRecursively(): void {
    if (this._isDestroyed) return;
    const children = [...this._childrenInLayoutOrder];
    for (const child of children) child.destroyRecursively();
    this.destroy();
  }

  protected destroySelf(): void {}

  // ------------------------------------------------------------------------------------------
  // Focus

  get focusable(): boolean { return this._focusable; }
  set focusable(value: boolean | undefined) {
    const v = value ?? (this.constructor as typeof Renderable).defaultFocusable;
    if (this._focusable === v) return;
    this._focusable = v;
    if (!v) this.blur();
    this.requestRender();
  }
  get focused(): boolean { return this._focused; }
  get hasFocusedDescendant(): boolean { return this._hasFocusedDescendant; }

  focus(): void {
    if (this._isDestroyed || this._focused || !this._focusable) return;
    this._focused = true;
    this._ctx.focusRenderable(this);
    this.requestRender();
    if (this._isDestroyed || !this._focused || this._ctx.currentFocusedRenderable !== this || this.keypressHandler) return;
    this.keypressHandler = (key: KeyEvent) => {
      if (this._isDestroyed || !this._focused || this._ctx.currentFocusedRenderable !== this) return;
      this._keyListeners["down"]?.(key);
      if (this._isDestroyed) return;
      if (!key.defaultPrevented) this.handleKeyPress?.(key);
    };
    this.pasteHandler = (event: PasteEvent) => {
      if (this._isDestroyed || !this._focused || this._ctx.currentFocusedRenderable !== this) return;
      this._pasteListener?.call(this, event);
      if (this._isDestroyed) return;
      if (!event.defaultPrevented) this.handlePaste?.(event);
    };
    this._ctx._internalKeyInput.onInternal("keypress", this.keypressHandler);
    this._ctx._internalKeyInput.onInternal("paste", this.pasteHandler);
    this.propagateFocusChange(true);
    this.emit("focused");
  }

  blur(): void {
    if (!this._focused) return;
    this._focused = false;
    const keypress = this.keypressHandler, paste = this.pasteHandler;
    this.keypressHandler = null;
    this.pasteHandler = null;
    if (keypress) this._ctx._internalKeyInput.offInternal("keypress", keypress);
    if (paste) this._ctx._internalKeyInput.offInternal("paste", paste);
    this.propagateFocusChange(false);
    this._ctx.blurRenderable(this);
    this.emit("blurred");
    this.requestRender();
  }

  propagateFocusChange(hasFocus: boolean): void {
    let parent = this.parent;
    while (parent) {
      if (!hasFocus) hasFocus = parent._childrenInLayoutOrder.some(c => !c._isDestroyed && (c._focused || c._hasFocusedDescendant));
      parent._hasFocusedDescendant = hasFocus;
      hasFocus ||= parent._focused;
      parent = parent.parent;
    }
    this.requestRender();
  }

  handleKeyPress?(key: KeyEvent): boolean;
  handlePaste?(event: PasteEvent): void;

  // ------------------------------------------------------------------------------------------
  // The mouse

  processMouseEvent(event: MouseEvent): void {
    event.currentTarget = this;
    this._mouseListener?.call(this, event);
    if (this._isDestroyed) return;
    this._mouseListeners[event.type]?.call(this, event);
    if (this._isDestroyed) return;
    this.onMouseEvent(event);
    if (this.parent && !event.propagationStopped) this.parent.processMouseEvent(event);
  }

  protected onMouseEvent(_event: MouseEvent): void {}

  set onMouse(handler: ((event: MouseEvent) => void) | null | undefined) { this._mouseListener = handler ?? null; }
  private setMouse(type: string, handler: ((event: MouseEvent) => void) | null | undefined): void {
    if (handler) this._mouseListeners[type] = handler;
    else delete this._mouseListeners[type];
  }
  set onMouseDown(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("down", h); }
  set onMouseUp(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("up", h); }
  set onMouseMove(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("move", h); }
  set onMouseDrag(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("drag", h); }
  set onMouseDragEnd(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("drag-end", h); }
  set onMouseDrop(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("drop", h); }
  set onMouseOver(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("over", h); }
  set onMouseOut(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("out", h); }
  set onMouseScroll(h: ((event: MouseEvent) => void) | null | undefined) { this.setMouse("scroll", h); }
  set onPaste(handler: ((event: PasteEvent) => void) | undefined) { this._pasteListener = handler; }
  get onPaste(): ((event: PasteEvent) => void) | undefined { return this._pasteListener; }
  set onKeyDown(handler: ((key: KeyEvent) => void) | undefined) { if (handler) this._keyListeners["down"] = handler; else delete this._keyListeners["down"]; }
  get onKeyDown(): ((key: KeyEvent) => void) | undefined { return this._keyListeners["down"]; }
  set onSizeChange(handler: (() => void) | undefined) { this._sizeChangeListener = handler; }
  get onSizeChange(): (() => void) | undefined { return this._sizeChangeListener; }

  private applyEventOptions(options: RenderableOptions): void {
    this.onMouse = options.onMouse as never;
    this.onMouseDown = options.onMouseDown as never;
    this.onMouseUp = options.onMouseUp as never;
    this.onMouseMove = options.onMouseMove as never;
    this.onMouseDrag = options.onMouseDrag as never;
    this.onMouseDragEnd = options.onMouseDragEnd as never;
    this.onMouseDrop = options.onMouseDrop as never;
    this.onMouseOver = options.onMouseOver as never;
    this.onMouseOut = options.onMouseOut as never;
    this.onMouseScroll = options.onMouseScroll as never;
    this.onKeyDown = options.onKeyDown as never;
    this.onSizeChange = options.onSizeChange as never;
  }

  // ------------------------------------------------------------------------------------------
  // Painting

  /** Draw yourself into the buffer (the scene's clip is already the scissor). */
  protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {}

  /** The renderer's call: renderBefore, renderSelf, renderAfter. */
  _paint(buffer: OptimizedBuffer, deltaTime: number): void {
    this.renderBefore?.call(this, buffer, deltaTime);
    this.renderSelf(buffer, deltaTime);
    this.renderAfter?.call(this, buffer, deltaTime);
    this.markClean();
  }

  /** Each frame, before layout. */
  onUpdate(_deltaTime: number): void {}

  /** The node's size changed after a layout (onLayoutResize: onResize, then onSizeChange). */
  onLayoutResize(width: number, height: number): void {
    if (!this._visible) return;
    this.onResize(width, height);
    this.requestRender();
  }

  protected onResize(_width: number, _height: number): void {
    this._sizeChangeListener?.call(this);
    this.emit("resize");
  }

  /** Children in paint order: by zIndex, then as added. */
  paintOrder(): Renderable[] {
    const children = this._childrenInLayoutOrder;
    if (children.length < 2 || children.every(c => c._zIndex === children[0]!._zIndex)) return children;
    return children.map((c, i) => ({ c, i })).sort((a, b) => a.c._zIndex - b.c._zIndex || a.i - b.i).map(e => e.c);
  }

  /** The cells inside this node's border, for clipping its children (overflow hidden). */
  get clipsChildren(): boolean { return this._overflow !== "visible"; }
  get borderInsets(): { top: number; right: number; bottom: number; left: number } {
    const s = this.borderSidesForLayout;
    return { top: s.top ? 1 : 0, right: s.right ? 1 : 0, bottom: s.bottom ? 1 : 0, left: s.left ? 1 : 0 };
  }

  getLayout(): { left: number; top: number; width: number; height: number } {
    const l = this._layout;
    return { left: l.left, top: l.top, width: l.width, height: l.height };
  }

  // Selection isn't part of this terminal.
  hasSelection(): boolean { return false; }
  getSelectedText(): string { return ""; }
  shouldStartSelection(_x: number, _y: number): boolean { return false; }
}

export class RootRenderable extends Renderable {
  constructor(ctx: RenderContext) {
    super(ctx, { id: "__root__", zIndex: 0, visible: true, width: ctx.width, height: ctx.height });
  }

  override propagateLiveCount(delta: number): void {
    const before = this._liveCount;
    this._liveCount += delta;
    if (before === 0 && this._liveCount > 0) this._ctx.requestLive();
    else if (before > 0 && this._liveCount === 0) this._ctx.dropLive();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.emit("resized", { width, height });
  }
}

export { Align, Direction, Display, Edge, FlexDirection, Gutter, Justify, Overflow, PositionType, Wrap };
