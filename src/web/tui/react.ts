import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ReactReconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority, NoEventPriority } from "react-reconciler/constants.js";
import { ASCIIFontRenderable } from "./ascii-font.ts";
import { BoxRenderable } from "./box.ts";
import type { KeyEvent, KeyHandler, PasteEvent } from "./events.ts";
import { InputRenderable, InputRenderableEvents } from "./input.ts";
import { isRenderable, Renderable, type RenderContext } from "./renderable.ts";
import { CliRenderEvents, type CliRenderer } from "./renderer.ts";
import { ScrollBoxRenderable } from "./scrollbox.ts";
import { TextNodeRenderable, TextRenderable, type TextNodeOptions } from "./text.ts";

/**
 * React for this terminal: @opentui/react's reconciler, components and hooks (MIT), over the
 * renderables here. The host config is OpenTUI's own: an element becomes `new Component(ctx,
 * { id, ...props })`, props are set as properties (onInput, onSubmit and focused as OpenTUI wires
 * them), strings and spans live inside a <text>, and every commit asks for a frame.
 */

// ---------------------------------------------------------------------------------------------
// Spans

const textNodeKeys = ["span", "b", "strong", "i", "em", "u", "br", "a"];

class SpanRenderable extends TextNodeRenderable {
  readonly ctx: RenderContext | null;
  constructor(ctx: RenderContext | null, options: TextNodeOptions) { super(options); this.ctx = ctx; }
}

class TextModifierRenderable extends SpanRenderable {
  constructor(options: TextNodeOptions, modifier: string) {
    super(null, options);
    if (modifier === "b" || modifier === "strong") this.attributes = (this.attributes || 0) | 1;
    else if (modifier === "i" || modifier === "em") this.attributes = (this.attributes || 0) | 4;
    else if (modifier === "u") this.attributes = (this.attributes || 0) | 8;
  }
}

class BoldSpanRenderable extends TextModifierRenderable { constructor(_ctx: unknown, options: TextNodeOptions) { super(options, "b"); } }
class ItalicSpanRenderable extends TextModifierRenderable { constructor(_ctx: unknown, options: TextNodeOptions) { super(options, "i"); } }
class UnderlineSpanRenderable extends TextModifierRenderable { constructor(_ctx: unknown, options: TextNodeOptions) { super(options, "u"); } }
class LineBreakRenderable extends SpanRenderable {
  constructor(_ctx: unknown, options: TextNodeOptions) { super(null, options); this.add("\n"); }
}
class LinkRenderable extends SpanRenderable {
  constructor(_ctx: unknown, options: TextNodeOptions & { href?: string }) { super(null, { ...options, link: { url: options.href ?? "" } }); }
}

type Constructor = new (ctx: any, options: any) => unknown;

export const baseComponents: Record<string, Constructor> = {
  box: BoxRenderable,
  text: TextRenderable,
  input: InputRenderable,
  scrollbox: ScrollBoxRenderable,
  "ascii-font": ASCIIFontRenderable,
  span: SpanRenderable,
  br: LineBreakRenderable,
  b: BoldSpanRenderable,
  strong: BoldSpanRenderable,
  i: ItalicSpanRenderable,
  em: ItalicSpanRenderable,
  u: UnderlineSpanRenderable,
  a: LinkRenderable,
};

export const componentCatalogue: Record<string, Constructor> = { ...baseComponents };

export function extend(objects: Record<string, Constructor>): void {
  Object.assign(componentCatalogue, objects);
}

export function getComponentCatalogue(): Record<string, Constructor> { return componentCatalogue; }

// ---------------------------------------------------------------------------------------------
// The host config

const ids = new Map<string, number>();
function nextId(type: string): string {
  const n = (ids.get(type) ?? 0) + 1;
  ids.set(type, n);
  return `${type}-${n}`;
}

type Listener = (...args: any[]) => void;
type Instance = Renderable | TextNodeRenderable;
type Container = Renderable;

function listen(instance: { on(e: string, l: Listener): unknown; off(e: string, l: Listener): unknown }, event: string, listener: Listener | undefined, previous: Listener | undefined): void {
  if (previous) instance.off(event, previous);
  if (listener) instance.on(event, listener);
}

function setStyle(instance: Record<string, unknown>, styles: Record<string, unknown> | null | undefined, old: Record<string, unknown> | null | undefined): void {
  if (old && typeof old === "object") for (const name of Object.keys(old)) if (!styles || !(name in styles)) instance[name] = null;
  if (styles && typeof styles === "object") for (const [name, value] of Object.entries(styles)) if (value !== old?.[name]) instance[name] = value;
}

function setProperty(instance: Instance, key: string, value: unknown, old?: unknown): void {
  switch (key) {
    case "onChange":
      if (instance instanceof InputRenderable) listen(instance, InputRenderableEvents.CHANGE, value as Listener, old as Listener);
      break;
    case "onInput":
      if (instance instanceof InputRenderable) listen(instance, InputRenderableEvents.INPUT, value as Listener, old as Listener);
      break;
    case "onSubmit":
      if (instance instanceof InputRenderable) listen(instance, InputRenderableEvents.ENTER, value as Listener, old as Listener);
      break;
    case "focused":
      if (isRenderable(instance)) { if (value) instance.focus(); else instance.blur(); }
      break;
    case "style":
      setStyle(instance as unknown as Record<string, unknown>, value as Record<string, unknown>, old as Record<string, unknown>);
      break;
    case "children":
      break;
    default:
      (instance as unknown as Record<string, unknown>)[key] = value;
  }
}

function setInitialProperties(instance: Instance, props: Record<string, unknown>): void {
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (value == null) continue;
    setProperty(instance, key, value);
  }
}

function updateProperties(instance: Instance, oldProps: Record<string, unknown>, newProps: Record<string, unknown>): void {
  for (const key of Object.keys(oldProps)) {
    if (oldProps[key] != null && !Object.hasOwn(newProps, key)) setProperty(instance, key, null, oldProps[key]);
  }
  for (const key of Object.keys(newProps)) {
    const next = newProps[key], previous = oldProps[key];
    if (next !== previous && (next != null || previous != null)) setProperty(instance, key, next, previous);
  }
}

let currentUpdatePriority: number = NoEventPriority;

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  createInstance(type: string, props: Record<string, unknown>, root: Container, hostContext: { isInsideText: boolean }): Instance {
    if (textNodeKeys.includes(type) && !hostContext.isInsideText) throw new Error(`Component of type "${type}" must be created inside of a text node`);
    const Component = componentCatalogue[type];
    if (!Component) throw new Error(`Unknown component type: ${type}`);
    return new Component(root.ctx, { id: nextId(type), ...props }) as Instance;
  },
  appendChild(parent: Instance, child: Instance) { (parent as { add(c: unknown): unknown }).add(child); },
  removeChild(parent: Instance, child: Instance) { if (!child.parent) return; (parent as { remove(c: unknown): void }).remove(child); },
  insertBefore(parent: Instance, child: Instance, before: Instance) { (parent as { insertBefore(c: unknown, b: unknown): unknown }).insertBefore(child, before); },
  insertInContainerBefore(parent: Container, child: Instance, before: Instance) { parent.insertBefore(child as Renderable, before); },
  removeChildFromContainer(parent: Container, child: Instance) { if (!child.parent) return; parent.remove(child as Renderable); },
  prepareForCommit() { return null; },
  resetAfterCommit(container: Container) { container.requestRender(); },
  getRootHostContext() { return { isInsideText: false }; },
  getChildHostContext(parent: { isInsideText: boolean }, type: string) { return { ...parent, isInsideText: ["text", ...textNodeKeys].includes(type) }; },
  shouldSetTextContent() { return false; },
  createTextInstance(text: string, _root: Container, hostContext: { isInsideText: boolean }) {
    if (!hostContext.isInsideText) throw new Error("Text must be created inside of a text node");
    return TextNodeRenderable.fromString(text);
  },
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  shouldAttemptEagerTransition() { return true; },
  finalizeInitialChildren(instance: Instance, _type: string, props: Record<string, unknown>) { setInitialProperties(instance, props); return false; },
  commitMount() {},
  commitUpdate(instance: Instance, _type: string, oldProps: Record<string, unknown>, newProps: Record<string, unknown>) { updateProperties(instance, oldProps, newProps); },
  commitTextUpdate(textInstance: TextNodeRenderable, _old: string, next: string) { textInstance.children = [next]; },
  appendChildToContainer(container: Container, child: Instance) { container.add(child as Renderable); },
  appendInitialChild(parent: Instance, child: Instance) { (parent as { add(c: unknown): unknown }).add(child); },
  hideInstance(instance: Instance) { instance.visible = false; },
  unhideInstance(instance: Instance) { instance.visible = true; },
  hideTextInstance(textInstance: TextNodeRenderable) { textInstance.visible = false; },
  unhideTextInstance(textInstance: TextNodeRenderable) { textInstance.visible = true; },
  clearContainer(container: Container) { for (const child of container.getChildren()) container.remove(child); },
  setCurrentUpdatePriority(priority: number) { currentUpdatePriority = priority; },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority() { return currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority; },
  maySuspendCommit() { return false; },
  maySuspendCommitOnUpdate() { return false; },
  maySuspendCommitInSyncRender() { return false; },
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  trackSchedulerEvent() {},
  resolveEventType() { return null; },
  resolveEventTimeStamp() { return -1.1; },
  preloadInstance() { return true; },
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady() { return null; },
  detachDeletedInstance(instance: Instance) { if (!instance.parent) instance.destroyRecursively(); },
  getPublicInstance(instance: Instance) { return instance; },
  preparePortalMount() {},
  isPrimaryRenderer: true,
  getInstanceFromNode() { return null; },
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope() { return null; },
  rendererPackageName: "@opentui/react",
  rendererVersion: "0.6.5",
};

const reconciler = ReactReconciler(hostConfig as never);

// ---------------------------------------------------------------------------------------------
// Roots

export const AppContext = createContext<{ keyHandler: KeyHandler | null; renderer: CliRenderer | null }>({ keyHandler: null, renderer: null });
export const useAppContext = () => useContext(AppContext);

class ErrorBoundary extends React.Component<{ children?: ReactNode }, { hasError: boolean; error: Error | null }> {
  override state = { hasError: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return React.createElement("box", { style: { flexDirection: "column", padding: 2 } }, React.createElement("text", { fg: "red" }, this.state.error.stack || this.state.error.message));
    }
    return this.props.children;
  }
}

export interface Root { render(node: ReactNode): void; unmount(): void }

export function createRoot(renderer: CliRenderer): Root {
  let container: ReturnType<typeof reconciler.createContainer> | null = null;
  const cleanup = () => {
    if (!container) return;
    reconciler.updateContainer(null, container, null, () => {});
    reconciler.flushSyncWork();
    container = null;
  };
  if (!renderer.isDestroyed) renderer.once(CliRenderEvents.DESTROY, cleanup);
  return {
    render(node: ReactNode) {
      if (renderer.isDestroyed) return;
      const element = React.createElement(AppContext.Provider, { value: { keyHandler: renderer.keyInput, renderer } }, React.createElement(ErrorBoundary, null, node));
      container = reconciler.createContainer(renderer.root, ConcurrentRoot, null, false, null, "", console.error, console.error, console.error, () => {});
      reconciler.updateContainer(element, container, null, () => {});
    },
    unmount: cleanup,
  };
}

const r = reconciler as unknown as { flushSyncFromReconciler?: <T>(fn: () => T) => T; flushSync?: <T>(fn: () => T) => T };
export const flushSync = r.flushSyncFromReconciler ?? r.flushSync;
export const createPortal = reconciler.createPortal;

// ---------------------------------------------------------------------------------------------
// Hooks

function useEffectEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  useLayoutEffect(() => { ref.current = handler; });
  return useCallback((...args: A) => ref.current(...args), []);
}

export const useRenderer = (): CliRenderer => {
  const { renderer } = useAppContext();
  if (!renderer) throw new Error("Renderer not found.");
  return renderer;
};

export function useKeyboard(handler: (key: KeyEvent) => void, options: { release?: boolean } = { release: false }): void {
  const { keyHandler } = useAppContext();
  const stable = useEffectEvent(handler);
  useEffect(() => {
    keyHandler?.on("keypress", stable);
    if (options?.release) keyHandler?.on("keyrelease", stable);
    return () => {
      keyHandler?.off("keypress", stable);
      if (options?.release) keyHandler?.off("keyrelease", stable);
    };
  }, [keyHandler, options.release]);
}

export function usePaste(handler: (event: PasteEvent) => void): void {
  const { keyHandler } = useAppContext();
  const stable = useEffectEvent(handler);
  useEffect(() => {
    keyHandler?.on("paste", stable);
    return () => { keyHandler?.off("paste", stable); };
  }, [keyHandler]);
}

export function useOnResize(callback: (width: number, height: number) => void): CliRenderer {
  const renderer = useRenderer();
  const stable = useEffectEvent(callback);
  useEffect(() => {
    renderer.on("resize", stable);
    return () => { renderer.off("resize", stable); };
  }, [renderer]);
  return renderer;
}

export function useTerminalDimensions(): { width: number; height: number } {
  const renderer = useRenderer();
  const [dimensions, setDimensions] = useState({ width: renderer.width, height: renderer.height });
  useOnResize((width, height) => setDimensions({ width, height }));
  return dimensions;
}

export function useFocus(handler: () => void): void {
  const renderer = useRenderer();
  const stable = useEffectEvent(handler);
  useEffect(() => { renderer.on("focus", stable); return () => { renderer.off("focus", stable); }; }, [renderer]);
}

export function useBlur(handler: () => void): void {
  const renderer = useRenderer();
  const stable = useEffectEvent(handler);
  useEffect(() => { renderer.on("blur", stable); return () => { renderer.off("blur", stable); }; }, [renderer]);
}

export const createElement = React.createElement;

/** The prop types the app imports (as type-only imports, so nothing at runtime). */
export type BoxProps = Record<string, unknown>;
