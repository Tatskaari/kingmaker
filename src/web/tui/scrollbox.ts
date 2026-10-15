import { BoxRenderable, type BoxOptions } from "./box.ts";
import type { OptimizedBuffer } from "./buffer.ts";
import type { KeyEvent, MouseEvent } from "./events.ts";
import { Renderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";
import { stringWidth } from "./width.ts";

/**
 * A scrolling box (@opentui/core's ScrollBox.ts, ScrollBar.ts and Slider.ts, MIT): a row of a
 * wrapper (a viewport clipping a content box) and a vertical scrollbar; the content moves by
 * translateY. Sticky scroll keeps it at the bottom (or top) as it grows, until the player scrolls
 * away; scrolling back to the edge sticks again. The scrollbar's track is the native slider's.
 */

export class SliderRenderable extends Renderable {
  private _orientation: "vertical" | "horizontal";
  private _value: number;
  private _min: number;
  private _max: number;
  private _viewPortSize: number;
  private _backgroundColor: RGBA;
  private _foregroundColor: RGBA;
  private _onChange: ((value: number) => void) | undefined;

  constructor(ctx: RenderContext, options: RenderableOptions<SliderRenderable> & { orientation: "vertical" | "horizontal"; value?: number; min?: number; max?: number; viewPortSize?: number; backgroundColor?: ColorInput; foregroundColor?: ColorInput; onChange?: (value: number) => void }) {
    super(ctx, { flexShrink: 0, ...options });
    this._orientation = options.orientation;
    this._min = options.min ?? 0;
    this._max = options.max ?? 100;
    this._value = options.value ?? this._min;
    this._viewPortSize = options.viewPortSize ?? Math.max(1, (this._max - this._min) * 0.1);
    this._onChange = options.onChange;
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor || "#252527"));
    this._foregroundColor = RGBA.clone(parseColor(options.foregroundColor || "#9a9ea3"));
  }

  get value(): number { return this._value; }
  set value(newValue: number) {
    const clamped = Math.max(this._min, Math.min(this._max, newValue ?? this._min));
    if (clamped !== this._value) this.publish(clamped);
  }
  private publish(value: number): void {
    if (value === this._value) return;
    this._value = value;
    this.requestRender();
    this._onChange?.(value);
    this.emit("change", { value });
  }
  get min(): number { return this._min; }
  set min(newMin: number) {
    newMin ??= 0;
    if (newMin === this._min) return;
    const below = this._value < newMin;
    this._min = newMin;
    if (below) this.publish(newMin);
    this.requestRender();
  }
  get max(): number { return this._max; }
  set max(newMax: number) {
    newMax ??= 100;
    if (newMax === this._max) return;
    const above = this._value > newMax;
    this._max = newMax;
    if (above) this.publish(Math.max(this._min, newMax));
    this.requestRender();
  }
  get viewPortSize(): number { return this._viewPortSize; }
  set viewPortSize(size: number) {
    const clamped = Math.max(0.01, Math.min(size ?? Math.max(1, (this._max - this._min) * 0.1), this._max - this._min));
    if (clamped !== this._viewPortSize) { this._viewPortSize = clamped; this.requestRender(); }
  }
  set foregroundColor(value: ColorInput) { this._foregroundColor = RGBA.clone(parseColor(value ?? "#9a9ea3")); this.requestRender(); }
  set backgroundColor(value: ColorInput) { this._backgroundColor = RGBA.clone(parseColor(value ?? "#252527")); this.requestRender(); }
  set orientation(value: "vertical" | "horizontal") { this._orientation = value; this.requestRender(); }

  /** sliderThumb: the thumb's size and start in half cells. */
  private thumb(width: number, height: number): { size: number; start: number } {
    const track = (this._orientation === "horizontal" ? width : height) * 2;
    const range = this._max - this._min;
    if (range === 0) return { size: track, start: 0 };
    const viewport = Math.max(1, this._viewPortSize);
    const content = range + viewport;
    const size = content <= viewport ? track : Math.max(1, Math.min(Math.floor(track * (viewport / content)), track));
    const offset = ((this._value - this._min) / range) * (track - size);
    const lower = Math.floor(offset);
    return { size, start: offset - lower < 0.5 ? lower : lower + 1 };
  }

  /** paintSlider. */
  protected override renderSelf(buffer: OptimizedBuffer): void {
    const l = this._layout;
    const thumb = this.thumb(l.width, l.height);
    const x = Math.trunc(l.screenX), y = Math.trunc(l.screenY);
    const fg = this._foregroundColor.packed, bg = this._backgroundColor.packed;
    buffer.fillRect(x, y, Math.trunc(l.width), Math.trunc(l.height), bg);
    const end = thumb.start + thumb.size;
    const vertical = this._orientation === "vertical";
    const along = vertical ? Math.trunc(l.height) : Math.trunc(l.width);
    const across = vertical ? Math.trunc(l.width) : Math.trunc(l.height);
    const first = Math.max(0, Math.floor(thumb.start / 2));
    const last = Math.min(along, Math.ceil(end / 2));
    for (let a = first; a < last; a++) {
      const cellStart = a * 2;
      const start = Math.max(thumb.start, cellStart);
      const coverage = Math.min(end, cellStart + 2) - start;
      const ch = coverage >= 2 ? "█" : !vertical ? (start === cellStart ? "▌" : "▐") : coverage > 0 ? (start === cellStart ? "▀" : "▄") : " ";
      for (let c = 0; c < across; c++) {
        const cx = vertical ? x + c : x + a, cy = vertical ? y + a : y + c;
        if (cx < 0 || cy < 0) continue;
        buffer.blend(cx, cy, ch, 1, fg, bg, 0);
      }
    }
  }
}

export class ArrowRenderable extends Renderable {
  private _direction: "up" | "down" | "left" | "right";
  private _foregroundColor: RGBA;
  private _backgroundColor: RGBA;
  private _attributes: number;
  private chars = { up: "▲", down: "▼", left: "◀", right: "▶" };

  constructor(ctx: RenderContext, options: RenderableOptions<ArrowRenderable> & { direction: "up" | "down" | "left" | "right"; foregroundColor?: ColorInput; backgroundColor?: ColorInput; attributes?: number }) {
    super(ctx, options);
    this._direction = options.direction;
    this._foregroundColor = RGBA.clone(parseColor(options.foregroundColor || RGBA.fromValues(1, 1, 1, 1)));
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor || RGBA.fromValues(0, 0, 0, 0)));
    this._attributes = options.attributes ?? 0;
    if (!options.width) this.width = stringWidth(this.chars[this._direction]);
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawText(this.chars[this._direction], this.x, this.y, this._foregroundColor, this._backgroundColor, this._attributes);
  }
}

export type ScrollUnit = "absolute" | "viewport" | "content" | "step";

export interface ScrollBarOptions extends RenderableOptions<ScrollBarRenderable> {
  orientation: "vertical" | "horizontal";
  showArrows?: boolean;
  arrowOptions?: Record<string, unknown>;
  trackOptions?: Record<string, unknown>;
  onChange?: (position: number) => void;
}

export class ScrollBarRenderable extends Renderable {
  protected static override readonly defaultFocusable: boolean = true;
  readonly slider: SliderRenderable;
  readonly startArrow: ArrowRenderable;
  readonly endArrow: ArrowRenderable;
  readonly orientation: "vertical" | "horizontal";
  private _scrollSize = 0;
  private _scrollPosition = 0;
  private _viewportSize = 0;
  private _showArrows = false;
  private _manualVisibility = false;
  private _onChange: ((position: number) => void) | undefined;
  scrollStep: number | null | undefined = null;

  constructor(ctx: RenderContext, { trackOptions, arrowOptions, orientation, showArrows = false, ...options }: ScrollBarOptions) {
    super(ctx, { flexDirection: orientation === "vertical" ? "column" : "row", alignSelf: "stretch", alignItems: "stretch", ...options });
    this._onChange = options.onChange;
    this.orientation = orientation;
    this._showArrows = showArrows;
    const range = Math.max(0, this._scrollSize - this._viewportSize);
    this.slider = new SliderRenderable(ctx, {
      orientation, min: 0, max: range, value: this._scrollPosition,
      viewPortSize: (trackOptions?.["viewPortSize"] as number | undefined) ?? Math.max(1, this._viewportSize),
      onChange: value => {
        if (this.isDestroyed) return;
        this._scrollPosition = Math.round(value);
        this._onChange?.(this._scrollPosition);
        if (!this.isDestroyed) this.emit("change", { position: this._scrollPosition });
      },
      ...(orientation === "vertical" ? { width: Math.max(1, Math.min(2, this.width)), height: "100%", marginLeft: "auto" } : { width: "100%", height: 1, marginTop: "auto" }),
      flexGrow: 1, flexShrink: 1,
      ...(trackOptions as object),
    });
    this.updateSlider();
    const arrow = arrowOptions ? { foregroundColor: arrowOptions["backgroundColor"], backgroundColor: arrowOptions["backgroundColor"], attributes: arrowOptions["attributes"], ...arrowOptions } : {};
    this.startArrow = new ArrowRenderable(ctx, { alignSelf: "center", visible: this._showArrows, direction: orientation === "vertical" ? "up" : "left", height: 1, ...(arrow as object) });
    this.endArrow = new ArrowRenderable(ctx, { alignSelf: "center", visible: this._showArrows, direction: orientation === "vertical" ? "down" : "right", height: 1, ...(arrow as object) });
    this.add(this.startArrow);
    this.add(this.slider);
    this.add(this.endArrow);
    for (const [a, direction] of [[this.startArrow, -1], [this.endArrow, 1]] as const) {
      a.onMouseDown = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); this.scrollBy(direction * 0.5, "viewport"); };
      a.onMouseUp = (event: MouseEvent) => event.stopPropagation();
    }
  }

  override get visible(): boolean { return super.visible; }
  override set visible(value: boolean) { this._manualVisibility = true; super.visible = value; }

  get scrollSize(): number { return this._scrollSize; }
  get scrollPosition(): number { return this._scrollPosition; }
  get viewportSize(): number { return this._viewportSize; }

  set scrollSize(value: number) {
    value ??= 0;
    if (value === this._scrollSize) return;
    this._scrollSize = value;
    this.recalculateVisibility();
    this.updateSlider();
    this.scrollPosition = this._scrollPosition;
  }

  set scrollPosition(value: number) {
    const position = Math.round(Math.min(Math.max(0, value ?? 0), this.scrollSize - this.viewportSize));
    if (!Number.isFinite(position)) return;
    if (position !== this._scrollPosition) {
      this._scrollPosition = position;
      this.updateSlider();
    }
  }

  set viewportSize(value: number) {
    value ??= 0;
    if (value === this._viewportSize) return;
    this.slider.viewPortSize = Math.max(1, value);
    this._viewportSize = value;
    this.recalculateVisibility();
    this.updateSlider();
    this.scrollPosition = this._scrollPosition;
  }

  set trackOptions(options: Record<string, unknown> | undefined) {
    for (const [key, value] of Object.entries(options ?? {})) (this.slider as unknown as Record<string, unknown>)[key] = value;
    this.requestRender();
  }
  set arrowOptions(_options: Record<string, unknown> | undefined) {}
  set showArrows(value: boolean) {
    if (value === this._showArrows) return;
    this._showArrows = value;
    this.startArrow.visible = value;
    this.endArrow.visible = value;
  }
  set onChange(handler: ((position: number) => void) | undefined) { this._onChange = handler; }

  private updateSlider(): void {
    const range = Math.max(0, this._scrollSize - this._viewportSize);
    this.slider.min = 0;
    this.slider.max = range;
    this.slider.value = Math.min(this._scrollPosition, range);
  }

  scrollBy(delta: number, unit: ScrollUnit = "absolute"): void {
    const multiplier = unit === "viewport" ? this.viewportSize : unit === "content" ? this.scrollSize : unit === "step" ? (this.scrollStep ?? 1) : 1;
    this.scrollPosition = this._scrollPosition + multiplier * delta;
  }

  private recalculateVisibility(): void {
    if (this._manualVisibility) return;
    const ratio = this.scrollSize <= this.viewportSize ? 1 : this.viewportSize / this.scrollSize;
    super.visible = ratio < 1;
  }

  override handleKeyPress(key: KeyEvent): boolean {
    const v = this.orientation === "vertical";
    switch (key.name) {
      case "left": case "h": if (v) return false; this.scrollBy(-1 / 5, "viewport"); return true;
      case "right": case "l": if (v) return false; this.scrollBy(1 / 5, "viewport"); return true;
      case "up": case "k": if (!v) return false; this.scrollBy(-1 / 5, "viewport"); return true;
      case "down": case "j": if (!v) return false; this.scrollBy(1 / 5, "viewport"); return true;
      case "pageup": this.scrollBy(-1 / 2, "viewport"); return true;
      case "pagedown": this.scrollBy(1 / 2, "viewport"); return true;
      case "home": this.scrollBy(-1, "content"); return true;
      case "end": this.scrollBy(1, "content"); return true;
    }
    return false;
  }
}

export class ContentRenderable extends BoxRenderable {
  viewportCulling: boolean;
  readonly viewport: BoxRenderable;
  constructor(ctx: RenderContext, viewport: BoxRenderable, viewportCulling: boolean, options: BoxOptions<any>) {
    super(ctx, options);
    this.viewport = viewport;
    this.viewportCulling = viewportCulling;
  }
}

export interface ScrollBoxOptions extends BoxOptions<ScrollBoxRenderable> {
  rootOptions?: BoxOptions<any>;
  wrapperOptions?: BoxOptions<any>;
  viewportOptions?: BoxOptions<any>;
  contentOptions?: BoxOptions<any>;
  scrollbarOptions?: Omit<ScrollBarOptions, "orientation">;
  verticalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">;
  horizontalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">;
  stickyScroll?: boolean;
  stickyStart?: "bottom" | "top" | "left" | "right";
  scrollX?: boolean;
  scrollY?: boolean;
  viewportCulling?: boolean;
}

const PADDING_KEYS = ["padding", "paddingX", "paddingY", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;

export class ScrollBoxRenderable extends BoxRenderable {
  protected static override readonly defaultFocusable: boolean = true;
  readonly wrapper: BoxRenderable;
  readonly viewport: BoxRenderable;
  readonly content: ContentRenderable;
  readonly horizontalScrollBar: ScrollBarRenderable;
  readonly verticalScrollBar: ScrollBarRenderable;
  private scrollAccumulatorX = 0;
  private scrollAccumulatorY = 0;
  private _stickyScroll: boolean;
  private _stickyScrollTop = false;
  private _stickyScrollBottom = false;
  private _stickyScrollLeft = false;
  private _stickyScrollRight = false;
  private _stickyStart: "bottom" | "top" | "left" | "right" | undefined;
  private _hasManualScroll = false;
  private _isApplyingStickyScroll = false;

  constructor(ctx: RenderContext, options: ScrollBoxOptions) {
    const { wrapperOptions, viewportOptions, contentOptions, rootOptions, scrollbarOptions, verticalScrollbarOptions, horizontalScrollbarOptions,
      stickyScroll = false, stickyStart, scrollX = false, scrollY = true, viewportCulling = true, ...rootBoxOptions } = options;
    const padding: Record<string, unknown> = {};
    for (const key of PADDING_KEYS) {
      if ((rootBoxOptions as Record<string, unknown>)[key] !== undefined) padding[key] = (rootBoxOptions as Record<string, unknown>)[key];
      if ((rootOptions as Record<string, unknown> | undefined)?.[key] !== undefined) padding[key] = (rootOptions as Record<string, unknown>)[key];
    }
    const strip = <T extends object>(o: T): T => { const c = { ...o } as Record<string, unknown>; for (const key of PADDING_KEYS) delete c[key]; return c as T; };
    super(ctx, { flexDirection: "row", alignItems: "stretch", ...strip(rootBoxOptions), ...(rootOptions ? strip(rootOptions) : {}) });
    this._stickyScroll = stickyScroll;
    this._stickyStart = stickyStart;
    this.wrapper = new BoxRenderable(ctx, { flexDirection: "column", flexGrow: 1, ...wrapperOptions });
    super.add(this.wrapper);
    this.viewport = new BoxRenderable(ctx, { flexDirection: "column", flexGrow: 1, overflow: "hidden", onSizeChange: () => this.recalculateBarProps(), ...viewportOptions });
    this.wrapper.add(this.viewport);
    this.content = new ContentRenderable(ctx, this.viewport, viewportCulling, {
      alignSelf: "flex-start", flexShrink: 0,
      ...(scrollX ? { minWidth: "100%" } : { minWidth: "100%", maxWidth: "100%" }),
      ...(scrollY ? { minHeight: "100%" } : { minHeight: "100%", maxHeight: "100%" }),
      onSizeChange: () => this.recalculateBarProps(),
      ...padding, ...contentOptions,
    });
    this.viewport.add(this.content);
    this.verticalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions, ...verticalScrollbarOptions,
      orientation: "vertical",
      onChange: position => { if (this.isDestroyed) return; this.content.translateY = -position; this.updateStickyState(); },
    });
    super.add(this.verticalScrollBar);
    this.horizontalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions, ...horizontalScrollbarOptions,
      orientation: "horizontal",
      onChange: position => { if (this.isDestroyed) return; this.content.translateX = -position; this.updateStickyState(); },
    });
    this.wrapper.add(this.horizontalScrollBar);
    this.recalculateBarProps();
    if (stickyStart && stickyScroll) this.applyStickyStart(stickyStart);
  }

  get stickyScroll(): boolean { return this._stickyScroll; }
  set stickyScroll(value: boolean) { this._stickyScroll = value; this.updateStickyState(); }
  get stickyStart(): "bottom" | "top" | "left" | "right" | undefined { return this._stickyStart; }
  set stickyStart(value: "bottom" | "top" | "left" | "right" | undefined) { this._stickyStart = value; this.updateStickyState(); }
  get scrollTop(): number { return this.verticalScrollBar.scrollPosition; }
  set scrollTop(value: number) { this.verticalScrollBar.scrollPosition = value; this.updateStickyState(); }
  get scrollLeft(): number { return this.horizontalScrollBar.scrollPosition; }
  set scrollLeft(value: number) { this.horizontalScrollBar.scrollPosition = value; this.updateStickyState(); }
  get scrollWidth(): number { return this.horizontalScrollBar.scrollSize; }
  get scrollHeight(): number { return this.verticalScrollBar.scrollSize; }

  private updateStickyState(): void {
    if (this.isDestroyed) return;
    if (!this._stickyScroll) { this.syncManualScrollState(); return; }
    const maxTop = Math.max(0, this.scrollHeight - this.viewport.height);
    const maxLeft = Math.max(0, this.scrollWidth - this.viewport.width);
    if (this.scrollTop <= 0) { this._stickyScrollTop = true; this._stickyScrollBottom = false; }
    else if (this.scrollTop >= maxTop) { this._stickyScrollTop = false; this._stickyScrollBottom = true; }
    else { this._stickyScrollTop = false; this._stickyScrollBottom = false; }
    if (this.scrollLeft <= 0) { this._stickyScrollLeft = true; this._stickyScrollRight = false; }
    else if (this.scrollLeft >= maxLeft) { this._stickyScrollLeft = false; this._stickyScrollRight = true; }
    else { this._stickyScrollLeft = false; this._stickyScrollRight = false; }
    this.syncManualScrollState();
  }

  private syncManualScrollState(): void {
    if (this.isDestroyed) return;
    if (!this._stickyScroll) { this._hasManualScroll = false; return; }
    const maxTop = Math.max(0, this.scrollHeight - this.viewport.height);
    const maxLeft = Math.max(0, this.scrollWidth - this.viewport.width);
    const scrollable = maxTop > 1 || maxLeft > 1;
    if (this._isApplyingStickyScroll) {
      if (this._hasManualScroll && scrollable && this.isAtStickyPosition()) this._hasManualScroll = false;
      return;
    }
    this._hasManualScroll = scrollable && !this.isAtStickyPosition();
  }

  private applyStickyStart(start: "bottom" | "top" | "left" | "right"): void {
    const was = this._isApplyingStickyScroll;
    this._isApplyingStickyScroll = true;
    try {
      switch (start) {
        case "top": this._stickyScrollTop = true; this._stickyScrollBottom = false; this.verticalScrollBar.scrollPosition = 0; break;
        case "bottom": this._stickyScrollTop = false; this._stickyScrollBottom = true; this.verticalScrollBar.scrollPosition = Math.max(0, this.scrollHeight - this.viewport.height); break;
        case "left": this._stickyScrollLeft = true; this._stickyScrollRight = false; this.horizontalScrollBar.scrollPosition = 0; break;
        case "right": this._stickyScrollLeft = false; this._stickyScrollRight = true; this.horizontalScrollBar.scrollPosition = Math.max(0, this.scrollWidth - this.viewport.width); break;
      }
    } finally {
      this._isApplyingStickyScroll = was;
    }
  }

  private isAtStickyPosition(): boolean {
    if (!this._stickyScroll || !this._stickyStart) return false;
    const maxTop = Math.max(0, this.scrollHeight - this.viewport.height);
    const maxLeft = Math.max(0, this.scrollWidth - this.viewport.width);
    switch (this._stickyStart) {
      case "top": return this.scrollTop === 0;
      case "bottom": return this.scrollTop >= maxTop;
      case "left": return this.scrollLeft === 0;
      case "right": return this.scrollLeft >= maxLeft;
    }
  }

  private isAtStickyReengagePoint(start: "bottom" | "top" | "left" | "right", maxTop: number, maxLeft: number): boolean {
    switch (start) {
      case "top": return maxTop > 0 && this.scrollTop <= 0;
      case "bottom": return maxTop > 0 && this.scrollTop >= maxTop - 1;
      case "left": return maxLeft > 0 && this.scrollLeft <= 0;
      case "right": return maxLeft > 0 && this.scrollLeft >= maxLeft - 1;
    }
  }

  scrollBy(delta: number | { x: number; y: number }, unit: ScrollUnit = "absolute"): void {
    if (typeof delta === "number") this.verticalScrollBar.scrollBy(delta, unit);
    else { this.verticalScrollBar.scrollBy(delta.y, unit); this.horizontalScrollBar.scrollBy(delta.x, unit); }
  }

  scrollTo(position: number | { x: number; y: number }): void {
    if (typeof position === "number") this.scrollTop = position;
    else { this.scrollTop = position.y; this.scrollLeft = position.x; }
  }

  override add(obj: Renderable | null | undefined, index?: number): number { return this.content.add(obj, index); }
  override insertBefore(obj: Renderable | null | undefined, anchor?: unknown): number { return this.content.insertBefore(obj, anchor); }
  override remove(child: Renderable): void {
    if (child.parent === this) { super.remove(child); return; }
    this.content.remove(child);
  }
  override getChildren(): Renderable[] { return this.content.getChildren(); }

  protected override onMouseEvent(event: MouseEvent): void {
    if (event.type !== "scroll") return;
    let dir = event.scroll?.direction;
    if (event.modifiers.shift) dir = dir === "up" ? "left" : dir === "down" ? "right" : dir === "right" ? "down" : "up";
    const amount = event.scroll?.delta ?? 0;
    if (dir === "up" || dir === "down") {
      this.scrollAccumulatorY += dir === "up" ? -amount : amount;
      const whole = Math.trunc(this.scrollAccumulatorY);
      if (whole !== 0) { this.scrollTop += whole; this.scrollAccumulatorY -= whole; }
    } else if (dir === "left" || dir === "right") {
      this.scrollAccumulatorX += dir === "left" ? -amount : amount;
      const whole = Math.trunc(this.scrollAccumulatorX);
      if (whole !== 0) { this.scrollLeft += whole; this.scrollAccumulatorX -= whole; }
    }
    this.syncManualScrollState();
  }

  override handleKeyPress(key: KeyEvent): boolean {
    if (this.verticalScrollBar.handleKeyPress(key) || this.horizontalScrollBar.handleKeyPress(key)) {
      this.scrollAccumulatorX = this.scrollAccumulatorY = 0;
      this.syncManualScrollState();
      return true;
    }
    return false;
  }

  /** After layout: the bars from the content and viewport sizes, and sticky scroll put back. */
  recalculateBarProps(): void {
    if (this.isDestroyed) return;
    const was = this._isApplyingStickyScroll;
    this._isApplyingStickyScroll = true;
    try {
      this.verticalScrollBar.scrollSize = this.content.height;
      this.verticalScrollBar.viewportSize = this.viewport.height;
      this.horizontalScrollBar.scrollSize = this.content.width;
      this.horizontalScrollBar.viewportSize = this.viewport.width;
      if (this._stickyScroll) {
        const maxTop = Math.max(0, this.scrollHeight - this.viewport.height);
        const maxLeft = Math.max(0, this.scrollWidth - this.viewport.width);
        const start = this._stickyStart;
        if (start && !this._hasManualScroll) this.applyStickyStart(start);
        else if (start && this._hasManualScroll && this.isAtStickyReengagePoint(start, maxTop, maxLeft)) {
          this._hasManualScroll = false;
          this.applyStickyStart(start);
        } else if (!this._hasManualScroll) {
          if (this._stickyScrollTop) this.scrollTop = 0;
          else if (this._stickyScrollBottom && maxTop > 0) this.scrollTop = maxTop;
          if (this._stickyScrollLeft) this.scrollLeft = 0;
          else if (this._stickyScrollRight && maxLeft > 0) this.scrollLeft = maxLeft;
        }
      }
    } finally {
      this._isApplyingStickyScroll = was;
    }
  }

  // Padding props go to the content box.
  override set padding(v: unknown) { this.content.padding = v; this.requestRender(); }
  override set paddingX(v: unknown) { this.content.paddingX = v; this.requestRender(); }
  override set paddingY(v: unknown) { this.content.paddingY = v; this.requestRender(); }
  override set paddingTop(v: unknown) { this.content.paddingTop = v; this.requestRender(); }
  override set paddingRight(v: unknown) { this.content.paddingRight = v; this.requestRender(); }
  override set paddingBottom(v: unknown) { this.content.paddingBottom = v; this.requestRender(); }
  override set paddingLeft(v: unknown) { this.content.paddingLeft = v; this.requestRender(); }

  set verticalScrollbarOptions(options: Record<string, unknown> | undefined) { assign(this.verticalScrollBar, options); this.requestRender(); }
  set horizontalScrollbarOptions(options: Record<string, unknown> | undefined) { assign(this.horizontalScrollBar, options); this.requestRender(); }
  set scrollbarOptions(options: Record<string, unknown> | undefined) { assign(this.verticalScrollBar, options); assign(this.horizontalScrollBar, options); this.requestRender(); }
  set contentOptions(options: Record<string, unknown> | undefined) { assign(this.content, options); this.requestRender(); }
  set viewportOptions(options: Record<string, unknown> | undefined) { assign(this.viewport, options); this.requestRender(); }
  set wrapperOptions(options: Record<string, unknown> | undefined) { assign(this.wrapper, options); this.requestRender(); }
  set rootOptions(options: Record<string, unknown> | undefined) { assign(this, options); this.requestRender(); }
  set viewportCulling(value: boolean) { this.content.viewportCulling = value; this.requestRender(); }
  get viewportCulling(): boolean { return this.content.viewportCulling; }
  set scrollX(_value: boolean) {}
  set scrollY(_value: boolean) {}
}

function assign(target: object, options: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(options ?? {})) (target as Record<string, unknown>)[key] = value;
}
