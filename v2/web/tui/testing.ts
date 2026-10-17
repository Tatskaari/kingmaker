// Copied from the prototype's src/web/tui/testing.ts at 44c6d4a, whole, unchanged.
import { act, type ReactNode } from "react";
import { createRoot } from "./react.ts";
import { CliRenderer, type CliRendererConfig } from "./renderer.ts";
import { initLayout } from "./renderable.ts";

/**
 * A test renderer, as @opentui/core/testing's and @opentui/react/test-utils' (createTestRenderer,
 * testRender): no terminal, a frame on renderOnce(), keys and the mouse fed in as a terminal would
 * send them. The checks that drive the real screens (src/app/smoke, the comparison with OpenTUI)
 * run against this the same way they run against OpenTUI's.
 */

const KEY_CODES: Record<string, string> = {
  RETURN: "\r", LINEFEED: "\n", TAB: "\t", BACKSPACE: "\b", DELETE: "\x1b[3~", HOME: "\x1b[H", END: "\x1b[F", ESCAPE: "\x1b",
  ARROW_UP: "\x1b[A", ARROW_DOWN: "\x1b[B", ARROW_RIGHT: "\x1b[C", ARROW_LEFT: "\x1b[D",
  F1: "\x1bOP", F2: "\x1bOQ", F3: "\x1bOR", F4: "\x1bOS", F5: "\x1b[15~", F6: "\x1b[17~", F7: "\x1b[18~", F8: "\x1b[19~", F9: "\x1b[20~",
  F10: "\x1b[21~", F11: "\x1b[23~", F12: "\x1b[24~",
};

interface Modifiers { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean; hyper?: boolean }

function keySequence(key: string, modifiers?: Modifiers): string {
  let code = KEY_CODES[key] ?? key;
  if (modifiers) {
    if (code.startsWith("\x1b[") && code.length > 2) {
      const m = 1 + (modifiers.shift ? 1 : 0) + (modifiers.meta ? 2 : 0) + (modifiers.ctrl ? 4 : 0) + (modifiers.super ? 8 : 0) + (modifiers.hyper ? 16 : 0);
      if (m > 1) {
        const tilde = /^\x1b\[(\d+)~$/.exec(code);
        code = tilde ? `\x1b[${tilde[1]};${m}~` : `\x1b[1;${m}${code.slice(2)}`;
      }
    } else if (modifiers.ctrl && code.length === 1) {
      const c = code.toLowerCase().charCodeAt(0);
      if (c >= 97 && c <= 122) code = String.fromCharCode(c - 96);
    } else if (modifiers.meta) code = `\x1b${code}`;
    if (modifiers.shift && code.length === 1 && code >= "a" && code <= "z") code = code.toUpperCase();
  }
  return code;
}

export function createMockKeys(renderer: CliRenderer) {
  const feed = (s: string) => renderer.processInput(s);
  return {
    pressKeys: async (keys: string[], delayMs = 0) => { for (const k of keys) { feed(keySequence(k)); if (delayMs) await new Promise(r => setTimeout(r, delayMs)); } },
    pressKey: (key: string, modifiers?: Modifiers) => feed(keySequence(key, modifiers)),
    typeText: async (text: string, delayMs = 0) => { for (const ch of text) { feed(ch); if (delayMs) await new Promise(r => setTimeout(r, delayMs)); } },
    pressEnter: (modifiers?: Modifiers) => feed(keySequence("RETURN", modifiers)),
    pressEscape: (modifiers?: Modifiers) => feed(keySequence("ESCAPE", modifiers)),
    pressTab: (modifiers?: Modifiers) => feed(modifiers?.shift ? "\x1b[Z" : "\t"),
    pressBackspace: (modifiers?: Modifiers) => feed(modifiers?.meta ? "\x1b\x7f" : "\x7f"),
    pressArrow: (direction: "up" | "down" | "left" | "right", modifiers?: Modifiers) => feed(keySequence(`ARROW_${direction.toUpperCase()}`, modifiers)),
    pressCtrlC: () => feed("\x03"),
    pasteBracketedText: async (text: string) => feed(`\x1b[200~${text}\x1b[201~`),
  };
}

export const MouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2, WHEEL_UP: 64, WHEEL_DOWN: 65, WHEEL_LEFT: 66, WHEEL_RIGHT: 67 } as const;

export function createMockMouse(renderer: CliRenderer) {
  let position = { x: 0, y: 0 };
  const pressed = new Set<number>();
  const sgr = (code: number, x: number, y: number, release = false) => `\x1b[<${code};${x + 1};${y + 1}${release ? "m" : "M"}`;
  const mods = (m?: { shift?: boolean; alt?: boolean; ctrl?: boolean }) => (m?.shift ? 4 : 0) | (m?.alt ? 8 : 0) | (m?.ctrl ? 16 : 0);
  const feed = (s: string) => renderer.processInput(s);
  type Options = { button?: number; modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean }; delayMs?: number };
  const moveTo = async (x: number, y: number, options: Options = {}) => {
    const held = [...pressed][0];
    feed(sgr((held !== undefined ? held : 3) | 32 | mods(options.modifiers), x, y));
    position = { x, y };
  };
  const pressDown = async (x: number, y: number, button: number = MouseButtons.LEFT, options: Options = {}) => {
    feed(sgr(button | mods(options.modifiers), x, y));
    pressed.add(button);
    position = { x, y };
  };
  const release = async (x: number, y: number, button: number = MouseButtons.LEFT, options: Options = {}) => {
    feed(sgr(button | mods(options.modifiers), x, y, true));
    pressed.delete(button);
    position = { x, y };
  };
  return {
    moveTo,
    pressDown,
    release,
    click: async (x: number, y: number, button: number = MouseButtons.LEFT, options: Options = {}) => {
      await pressDown(x, y, button, options);
      if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
      await release(x, y, button, options);
    },
    doubleClick: async (x: number, y: number, button: number = MouseButtons.LEFT) => {
      for (let i = 0; i < 2; i++) { await pressDown(x, y, button); await release(x, y, button); }
    },
    drag: async (sx: number, sy: number, ex: number, ey: number, button: number = MouseButtons.LEFT) => {
      await pressDown(sx, sy, button);
      feed(sgr(button | 32, ex, ey));
      await release(ex, ey, button);
    },
    scroll: async (x: number, y: number, direction: "up" | "down" | "left" | "right", options: Options = {}) => {
      const code = { up: 64, down: 65, left: 66, right: 67 }[direction];
      feed(sgr(code | mods(options.modifiers), x, y));
    },
    getCurrentPosition: () => ({ ...position }),
    getPressedButtons: () => [...pressed],
  };
}

export interface TestRendererSetup {
  renderer: CliRenderer;
  mockInput: ReturnType<typeof createMockKeys>;
  mockMouse: ReturnType<typeof createMockMouse>;
  renderOnce: () => Promise<void>;
  captureCharFrame: () => string;
  captureSpans: () => ReturnType<CliRenderer["captureSpans"]>;
  resize: (width: number, height: number) => void;
  dispose: () => Promise<void>;
}

export async function createTestRenderer(options: CliRendererConfig & { width?: number; height?: number; onDestroy?: () => void }): Promise<TestRendererSetup> {
  await initLayout();
  const renderer = new CliRenderer(options.width ?? 80, options.height ?? 24, { ...options, terminal: undefined });
  return {
    renderer,
    mockInput: createMockKeys(renderer),
    mockMouse: createMockMouse(renderer),
    renderOnce: async () => { await Promise.resolve(); renderer.renderNow(); },
    captureCharFrame: () => renderer.captureCharFrame(),
    captureSpans: () => renderer.captureSpans(),
    resize: (w, h) => renderer.resize(w, h),
    dispose: async () => { options.onDestroy?.(); renderer.destroy(); },
  };
}

/** @opentui/react/test-utils' testRender. */
export async function testRender(node: ReactNode, options: CliRendererConfig & { width?: number; height?: number; onDestroy?: () => void }): Promise<TestRendererSetup> {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let root: ReturnType<typeof createRoot> | null = null;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({
    ...options,
    onDestroy() {
      act(() => { root?.unmount(); root = null; });
      options.onDestroy?.();
      g.IS_REACT_ACT_ENVIRONMENT = false;
    },
  });
  root = createRoot(setup.renderer);
  act(() => { root?.render(node); });
  return setup;
}
