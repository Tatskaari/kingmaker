import { intersect, OptimizedBuffer, type ClipRect } from "./buffer.ts";
import { EventEmitter, InputSplitter, KeyHandler, MouseEvent, MouseParser, parseKeypress, type RawMouseEvent } from "./events.ts";
import { Direction, initLayout, Renderable, RootRenderable, type RenderContext } from "./renderable.ts";
import { parseColor, RGBA, type ColorInput } from "./rgba.ts";
import { releaseSelections } from "./textarea.ts";

/**
 * The renderer (@opentui/core's CliRenderer, with the native scene's frame: packages/native/src/
 * scene.zig and renderer.zig): each frame composes text, lays the tree out with Yoga, lets nodes
 * whose size changed react (a scrollbox resizing its bars, sticking to the bottom) and lays out
 * again if that changed anything, paints into a cell buffer with the hit grid alongside, and sends
 * the terminal only the cells that changed, in truecolor. Input comes in as the terminal's bytes:
 * keys, SGR mouse reports and bracketed pastes, dispatched as OpenTUI dispatches them.
 */

export interface TerminalIO {
  /** Bytes to the terminal (a string of escape sequences and text). */
  write(data: string): void;
}

export interface CliRendererConfig {
  exitOnCtrlC?: boolean;
  autoFocus?: boolean;
  targetFps?: number;
  maxFps?: number;
  useMouse?: boolean;
  enableMouseMovement?: boolean;
  backgroundColor?: ColorInput;
  width?: number;
  height?: number;
  /** Where the output goes; without one the renderer draws to its buffers only (tests). */
  terminal?: TerminalIO;
  /** Called on Ctrl+C when exitOnCtrlC is on (there's no process to exit here). */
  onExit?: () => void;
  [key: string]: unknown;
}

export const CliRenderEvents = { RESIZE: "resize", FRAME: "frame", DESTROY: "destroy", FOCUSED_RENDERABLE: "focused_renderable", FOCUS: "focus", BLUR: "blur" } as const;

const MAX_LAYOUT_ROUNDS = 8;
const ESC = "\x1b";

function sgrColor(c: number, background: boolean): string {
  if (background && (c & 0xff) === 0) return `${ESC}[49m`;
  return `${ESC}[${background ? 48 : 38};2;${(c >>> 24) & 255};${(c >>> 16) & 255};${(c >>> 8) & 255}m`;
}

function sgrAttributes(a: number): string {
  let s = "";
  if (a & 1) s += `${ESC}[1m`;
  if (a & 2) s += `${ESC}[2m`;
  if (a & 4) s += `${ESC}[3m`;
  if (a & 8) s += `${ESC}[4m`;
  if (a & 16) s += `${ESC}[5m`;
  if (a & 32) s += `${ESC}[7m`;
  if (a & 64) s += `${ESC}[8m`;
  if (a & 128) s += `${ESC}[9m`;
  return s;
}

interface Work { node: Renderable; clip: ClipRect }

export class CliRenderer extends EventEmitter implements RenderContext {
  readonly root: RootRenderable;
  width: number;
  height: number;
  readonly widthMethod = "unicode";
  readonly keyInput = new KeyHandler();
  get _internalKeyInput(): KeyHandler { return this.keyInput; }
  readonly isRenderer = true;
  private terminal: TerminalIO | undefined;
  private next: OptimizedBuffer;
  private current: OptimizedBuffer;
  private hitGrid: Uint32Array;
  private backgroundColor: number;
  private exitOnCtrlC: boolean;
  private autoFocus: boolean;
  private targetFrameTime: number;
  private minFrameTime: number;
  private useMouse: boolean;
  private enableMouseMovement: boolean;
  private onExit: (() => void) | undefined;
  private _isDestroyed = false;
  private _focused: Renderable | null = null;
  private layoutDirty = true;
  private forceRepaint = true;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private liveRequests = 0;
  private lastFrameTime = 0;
  private rendering = false;
  private rerender = false;
  private splitter = new InputSplitter();
  private mouseParser = new MouseParser();
  private lastOverRenderable: Renderable | undefined;
  private lastOverRenderableNum = 0;
  private capturedRenderable: Renderable | undefined;
  private cursor = { x: 1, y: 1, visible: false, style: "block", blinking: true, color: "" };
  private shownCursor = { x: 0, y: 0, visible: true, style: "", blinking: false, color: "" };
  private frameCursorSet = false;
  /** Frames drawn, bytes written, and the time frames took (for the page's checks). */
  readonly stats = { frames: 0, bytes: 0, renderMs: 0, slowestMs: 0 };

  constructor(width: number, height: number, config: CliRendererConfig = {}) {
    super();
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.terminal = config.terminal;
    this.backgroundColor = config.backgroundColor !== undefined ? parseColor(config.backgroundColor).packed : 0;
    this.exitOnCtrlC = config.exitOnCtrlC ?? true;
    this.autoFocus = config.autoFocus ?? true;
    this.targetFrameTime = 1000 / (config.targetFps || 30);
    this.minFrameTime = 1000 / (config.maxFps || 60);
    this.useMouse = config.useMouse ?? true;
    this.enableMouseMovement = config.enableMouseMovement ?? true;
    this.onExit = config.onExit;
    this.next = new OptimizedBuffer(this.width, this.height, { id: "next" });
    this.current = new OptimizedBuffer(this.width, this.height, { id: "current" });
    this.hitGrid = new Uint32Array(this.width * this.height);
    this.root = new RootRenderable(this);
    this.keyInput.on("keypress", key => {
      if (this.exitOnCtrlC && key.ctrl && key.name === "c") queueMicrotask(() => { this.destroy(); this.onExit?.(); });
    });
  }

  get isDestroyed(): boolean { return this._isDestroyed; }
  get currentFocusedRenderable(): Renderable | null { return this._focused; }
  get terminalWidth(): number { return this.width; }
  get terminalHeight(): number { return this.height; }

  /** The terminal's modes, as OpenTUI sets them up: the alternate screen, no cursor, the mouse (with motion), focus reports, bracketed paste. */
  setupTerminal(): void {
    if (!this.terminal) return;
    let s = `${ESC}[?1049h${ESC}[?25l${ESC}[2J`;
    if (this.useMouse) s += `${ESC}[?1000h${ESC}[?1002h${this.enableMouseMovement ? `${ESC}[?1003h` : ""}${ESC}[?1006h`;
    s += `${ESC}[?1004h${ESC}[?2004h`;
    this.write(s);
  }

  private write(data: string): void {
    if (!data || !this.terminal) return;
    this.stats.bytes += data.length;
    this.terminal.write(data);
  }

  // ------------------------------------------------------------------------------------------
  // Scheduling

  layoutChanged(): void { this.layoutDirty = true; }

  requestRender(): void {
    if (this._isDestroyed) return;
    if (this.rendering) { this.rerender = true; return; }
    if (this.liveRequests > 0 || this.renderTimer) return;
    const delay = Math.max(this.minFrameTime - (performance.now() - this.lastFrameTime), 0);
    this.renderTimer = setTimeout(() => { this.renderTimer = undefined; this.renderFrame(); }, delay);
  }

  requestLive(): void {
    this.liveRequests++;
    if (this.liveRequests === 1) this.liveTick();
  }

  dropLive(): void {
    this.liveRequests = Math.max(0, this.liveRequests - 1);
    if (this.liveRequests === 0 && this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = undefined; }
  }

  private liveTick(): void {
    if (this._isDestroyed || this.liveRequests === 0) return;
    const started = performance.now();
    this.renderFrame();
    const delay = Math.max(0, this.targetFrameTime - (performance.now() - started));
    this.liveTimer = setTimeout(() => { this.liveTimer = undefined; this.liveTick(); }, delay);
  }

  /** For tests: a frame now. */
  renderNow(): void { this.renderFrame(); }

  // ------------------------------------------------------------------------------------------
  // A frame

  private walk(node: Renderable, fn: (node: Renderable) => void): void {
    fn(node);
    for (const child of node.getChildrenInternal()) this.walk(child, fn);
  }

  private renderFrame(): void {
    if (this._isDestroyed || this.rendering) return;
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = undefined; }
    this.rendering = true;
    try {
      const now = performance.now();
      const delta = this.lastFrameTime ? now - this.lastFrameTime : 0;
      this.lastFrameTime = now;
      this.walk(this.root, node => { if (node.onLifecyclePass) node.onLifecyclePass(); });
      this.walk(this.root, node => node.onUpdate(delta));
      let work: Work[] = [];
      for (let round = 0; round < MAX_LAYOUT_ROUNDS; round++) {
        if (this.layoutDirty || this.root.yogaNode.isDirty()) {
          this.layoutDirty = false;
          this.root.yogaNode.calculateLayout(this.width, this.height, Direction.LTR);
        }
        work = this.prepare();
        if (!this.observe(work)) break;
      }
      // What's painted is where things are now (a hook may have scrolled something).
      work = this.prepare();
      for (const { node } of work) Object.assign(node._layout, node._next);
      this.paint(work, delta);
      this.flush();
      this.stats.frames++;
      const took = performance.now() - now;
      this.stats.renderMs += took;
      this.stats.slowestMs = Math.max(this.stats.slowestMs, took);
      this.emit(CliRenderEvents.FRAME);
    } catch (error) {
      console.error("Render error:", error);
    } finally {
      this.rendering = false;
    }
    if (this.rerender) {
      this.rerender = false;
      this.requestRender();
    }
  }

  /** The scene's preparation: visible nodes in paint order with their screen layout (into _next) and clip. */
  private prepare(): Work[] {
    const work: Work[] = [];
    const visit = (node: Renderable, parentX: number, parentY: number, clip: ClipRect) => {
      if (!node.visible) return;
      const computed = node.yogaNode.getComputedLayout();
      const layout = node._next;
      layout.left = computed.left;
      layout.top = computed.top;
      layout.width = Math.max(computed.width, 1);
      layout.height = Math.max(computed.height, 1);
      layout.screenX = parentX + computed.left + node.translateX;
      layout.screenY = parentY + computed.top + node.translateY;
      work.push({ node, clip });
      const children = node.paintOrder();
      if (!children.length) return;
      let childClip = clip;
      if (node.clipsChildren) {
        const b = node.borderInsets;
        childClip = intersect(clip, {
          x: Math.trunc(layout.screenX + b.left),
          y: Math.trunc(layout.screenY + b.top),
          width: Math.max(0, Math.trunc(layout.width) - (b.left + b.right)),
          height: Math.max(0, Math.trunc(layout.height) - (b.top + b.bottom)),
        }) ?? { x: 0, y: 0, width: 0, height: 0 };
      }
      for (const child of children) visit(child, layout.screenX, layout.screenY, childClip);
    };
    visit(this.root, 0, 0, { x: 0, y: 0, width: this.width, height: this.height });
    return work;
  }

  /**
   * The resize pass (the native scene's feedback): top down, each node takes its new layout, then
   * hears of a new size (onLayoutResize). True if any did, for another round.
   */
  private observe(work: Work[]): boolean {
    let any = false;
    for (const { node } of work) {
      Object.assign(node._layout, node._next);
      const w = node._layout.width, h = node._layout.height;
      const was = node._reportedSize;
      if (was && was.width === w && was.height === h) continue;
      node._reportedSize = { width: w, height: h };
      if (node === this.root || node.isDestroyed) continue;
      any = true;
      node.onLayoutResize(w, h);
    }
    return any;
  }

  private paint(work: Work[], delta: number): void {
    const buf = this.next;
    buf.clear(this.backgroundColor);
    this.hitGrid.fill(0);
    this.frameCursorSet = false;
    for (const { node, clip } of work) {
      if (node === this.root) continue;
      buf.clearScissorRects();
      buf.pushScissorRect(clip.x, clip.y, clip.width, clip.height);
      node._paint(buf, delta);
      const l = node._layout;
      const hit = intersect({ x: Math.trunc(l.screenX), y: Math.trunc(l.screenY), width: Math.trunc(l.width), height: Math.trunc(l.height) }, clip);
      if (hit && this.useMouse) {
        for (let y = Math.max(0, hit.y); y < Math.min(this.height, hit.y + hit.height); y++) {
          this.hitGrid.fill(node.num, y * this.width + Math.max(0, hit.x), y * this.width + Math.min(this.width, hit.x + hit.width));
        }
      }
    }
    buf.clearScissorRects();
    if (!this.frameCursorSet) this.cursor.visible = false;
  }

  /** The changed cells to the terminal (renderer.zig's diff): a run at a time, colours at the start of each. */
  private flush(): void {
    const next = this.next, cur = this.current, w = this.width;
    const force = this.forceRepaint;
    this.forceRepaint = false;
    let out = "";
    let runFg = -1, runBg = -1, runAttrs = -1, cursorX = -1, cursorY = -1, inRun = false;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const width = next.widths[i]!;
        const same = !force && next.chars[i] === cur.chars[i] && width === cur.widths[i] && next.fg[i] === cur.fg[i] && next.bg[i] === cur.bg[i] && next.attrs[i] === cur.attrs[i];
        if (same) { inRun = false; continue; }
        cur.chars[i] = next.chars[i]!; cur.widths[i] = width; cur.fg[i] = next.fg[i]!; cur.bg[i] = next.bg[i]!; cur.attrs[i] = next.attrs[i]!;
        if (width === 0) { inRun = false; continue; }
        const fg = next.fg[i]!, bg = next.bg[i]!, attrs = next.attrs[i]!;
        if (!inRun || cursorX !== x || cursorY !== y || fg !== runFg || bg !== runBg || attrs !== runAttrs) {
          if (cursorX !== x || cursorY !== y) out += `${ESC}[${y + 1};${x + 1}H`;
          if (attrs !== runAttrs || runAttrs === -1) {
            out += `${ESC}[0m${sgrColor(fg, false)}${sgrColor(bg, true)}${sgrAttributes(attrs)}`;
          } else {
            if (fg !== runFg) out += sgrColor(fg, false);
            if (bg !== runBg) out += sgrColor(bg, true);
          }
          runFg = fg; runBg = bg; runAttrs = attrs;
          inRun = true;
        }
        out += next.chars[i];
        cursorX = x + Math.max(1, width);
        cursorY = y;
      }
    }
    if (out) out = `${ESC}[?2026h${this.shownCursor.visible ? `${ESC}[?25l` : ""}${out}${ESC}[0m`;
    const c = this.cursor, shown = this.shownCursor;
    const hidden = out ? true : !shown.visible;
    if (c.visible) {
      if (c.color && c.color !== shown.color) { out += `${ESC}]12;${c.color}\x07`; shown.color = c.color; }
      const style = `${ESC}[${c.style === "line" ? (c.blinking ? 5 : 6) : c.style === "underline" ? (c.blinking ? 3 : 4) : c.blinking ? 1 : 2} q`;
      if (`${c.style}${c.blinking}` !== `${shown.style}${shown.blinking}`) { out += style; shown.style = c.style; shown.blinking = c.blinking; }
      if (out || c.x !== shown.x || c.y !== shown.y || hidden) out += `${ESC}[${c.y};${c.x}H${ESC}[?25h`;
      shown.x = c.x; shown.y = c.y; shown.visible = true;
    } else if (shown.visible) {
      out += `${ESC}[?25l`;
      shown.visible = false;
    }
    if (out.startsWith(`${ESC}[?2026h`)) out += `${ESC}[?2026l`;
    this.write(out);
  }

  // ------------------------------------------------------------------------------------------
  // The cursor (an input's), focus

  setCursorPosition(x: number, y: number, visible = true): void {
    this.cursor.x = Math.max(1, Math.trunc(x));
    this.cursor.y = Math.max(1, Math.trunc(y));
    this.cursor.visible = visible;
    if (visible) this.frameCursorSet = true;
  }

  setCursorStyle(options: { style?: string; blinking?: boolean; color?: unknown }): void {
    if (options.style) this.cursor.style = options.style;
    if (options.blinking !== undefined) this.cursor.blinking = options.blinking;
    if (options.color instanceof RGBA) {
      const [r, g, b] = options.color.toInts();
      this.cursor.color = `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }

  focusRenderable(renderable: Renderable): void {
    if (this._focused === renderable) return;
    const previous = this._focused;
    this._focused = renderable;
    previous?.blur();
    this.emit(CliRenderEvents.FOCUSED_RENDERABLE, renderable, previous);
  }

  blurRenderable(renderable: Renderable): void {
    if (this._focused !== renderable) return;
    this._focused = null;
    this.emit(CliRenderEvents.FOCUSED_RENDERABLE, null, renderable);
  }

  getSelection(): null { return null; }

  // ------------------------------------------------------------------------------------------
  // Input

  /** The terminal's bytes: keys, the mouse, pastes. */
  processInput(data: Uint8Array | string): void {
    if (this._isDestroyed) return;
    for (const event of this.splitter.push(data)) {
      try {
        if (event.type === "key") {
          const key = parseKeypress(event.sequence);
          if (key) this.keyInput.processParsedKey(key);
        } else if (event.type === "mouse") {
          const mouse = this.mouseParser.parse(event.sequence);
          if (mouse && this.useMouse) this.processMouse(mouse);
        } else if (event.type === "paste") {
          this.keyInput.processPaste(new TextEncoder().encode(event.text));
        }
      } catch (error) {
        console.error("Input handler error:", error);
      }
    }
  }

  private hitTest(x: number, y: number): Renderable | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    const num = this.hitGrid[y * this.width + x]!;
    return num ? Renderable.renderablesByNumber.get(num) : undefined;
  }

  private send(target: Renderable, event: MouseEvent): void {
    if (this._isDestroyed || target.isDestroyed) return;
    try { target.processMouseEvent(event); } catch (error) { console.error("Error in mouse handler:", error); }
  }

  private dispatchMouse(target: Renderable, attributes: RawMouseEvent): MouseEvent {
    const event = new MouseEvent(target, attributes);
    this.send(target, event);
    if (this.autoFocus && event.type === "down" && event.button === 0 && !event.defaultPrevented) {
      for (let current: Renderable | null = target; current; current = current.parent) {
        if (current.focusable) { current.focus(); break; }
      }
    }
    return event;
  }

  /** processSingleMouseEvent, without text selection (nothing here selects). */
  private processMouse(mouse: RawMouseEvent): void {
    if (mouse.type === "scroll") {
      const target = this.hitTest(mouse.x, mouse.y) ?? (this._focused && !this._focused.isDestroyed && this._focused.focused ? this._focused : undefined);
      if (target) this.send(target, new MouseEvent(target, mouse));
      return;
    }
    const hit = this.hitTest(mouse.x, mouse.y);
    const num = hit?.num ?? 0;
    const sameElement = num === this.lastOverRenderableNum;
    this.lastOverRenderableNum = num;
    if (!sameElement && (mouse.type === "drag" || mouse.type === "move")) {
      if (this.lastOverRenderable && this.lastOverRenderable !== this.capturedRenderable && !this.lastOverRenderable.isDestroyed) {
        this.send(this.lastOverRenderable, new MouseEvent(this.lastOverRenderable, { ...mouse, type: "out" }));
      }
      this.lastOverRenderable = hit;
      if (hit) this.send(hit, new MouseEvent(hit, { ...mouse, type: "over", source: this.capturedRenderable }));
    }
    if (this.capturedRenderable && mouse.type !== "up") {
      this.send(this.capturedRenderable, new MouseEvent(this.capturedRenderable, mouse));
      return;
    }
    if (this.capturedRenderable && mouse.type === "up") {
      const captured = this.capturedRenderable;
      this.send(captured, new MouseEvent(captured, { ...mouse, type: "drag-end" }));
      this.send(captured, new MouseEvent(captured, mouse));
      if (hit) this.send(hit, new MouseEvent(hit, { ...mouse, type: "drop", source: captured }));
      this.lastOverRenderable = captured;
      this.lastOverRenderableNum = captured.num;
      this.capturedRenderable = undefined;
      this.requestRender();
    }
    // A left click lets go of the zero-width selection a click on a textarea started (the native
    // renderer starts a new selection, or clears the old one): a click on the textarea starts it again.
    if (mouse.type === "down" && mouse.button === 0 && !mouse.modifiers.ctrl) releaseSelections();
    if (hit) {
      this.capturedRenderable = mouse.type === "drag" && mouse.button === 0 ? hit : undefined;
      this.dispatchMouse(hit, mouse);
    } else {
      this.capturedRenderable = undefined;
      this.lastOverRenderable = undefined;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Size and the end

  resize(width: number, height: number): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.next.resize(width, height);
    this.current.resize(width, height);
    this.hitGrid = new Uint32Array(width * height);
    this.forceRepaint = true;
    this.write(`${ESC}[0m${ESC}[2J`);
    this.root.resize(width, height);
    this.layoutDirty = true;
    this.emit(CliRenderEvents.RESIZE, width, height);
    this.requestRender();
  }

  /** Repaint every cell next frame (after the terminal was reset). */
  invalidate(): void { this.forceRepaint = true; this.requestRender(); }

  /** The screen as text, a row a line. */
  captureCharFrame(): string { return this.current.charFrame(); }

  /** The screen as runs of one style (OpenTUI's captureSpans). */
  captureSpans(): { cols: number; rows: number; cursor: [number, number]; lines: Array<{ spans: Array<{ text: string; fg: RGBA; bg: RGBA; attributes: number; width: number }> }> } {
    const b = this.current;
    const color = (c: number) => RGBA.fromInts((c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255);
    const lines = [];
    for (let y = 0; y < b.height; y++) {
      const spans: Array<{ text: string; fg: RGBA; bg: RGBA; attributes: number; width: number }> = [];
      let run: { text: string; fg: number; bg: number; attrs: number; width: number } | undefined;
      for (let x = 0; x < b.width; x++) {
        const i = y * b.width + x;
        if (b.widths[i] === 0) continue;
        const fg = b.fg[i]!, bg = b.bg[i]!, attrs = b.attrs[i]!;
        if (!run || run.fg !== fg || run.bg !== bg || run.attrs !== attrs) {
          if (run) spans.push({ text: run.text, fg: color(run.fg), bg: color(run.bg), attributes: run.attrs, width: run.width });
          run = { text: "", fg, bg, attrs, width: 0 };
        }
        run.text += b.chars[i];
        run.width += b.widths[i]!;
      }
      if (run) spans.push({ text: run.text, fg: color(run.fg), bg: color(run.bg), attributes: run.attrs, width: run.width });
      lines.push({ spans });
    }
    return { cols: b.width, rows: b.height, cursor: [this.cursor.x - 1, this.cursor.y - 1], lines };
  }
  /** The buffer as drawn last frame. */
  get frameBuffer(): OptimizedBuffer { return this.current; }

  destroy(): void {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.emit(CliRenderEvents.DESTROY);
    try { this.root.destroyRecursively(); } catch { /* already gone */ }
    if (this.terminal) this.write(`${ESC}[0m${ESC}[?2004l${ESC}[?1004l${ESC}[?1006l${ESC}[?1003l${ESC}[?1002l${ESC}[?1000l${ESC}[?25h${ESC}[2J${ESC}[?1049l`);
    this.removeAllListeners();
  }

  start(): void {}
  stop(): void {}
  pause(): void {}
  suspend(): void {}
  resume(): void {}
  get isRunning(): boolean { return this.liveRequests > 0; }
  get console(): { show(): void; hide(): void } { return { show() {}, hide() {} }; }
}

export async function createCliRenderer(config: CliRendererConfig = {}): Promise<CliRenderer> {
  await initLayout();
  const renderer = new CliRenderer(config.width ?? 80, config.height ?? 24, config);
  renderer.setupTerminal();
  return renderer;
}
