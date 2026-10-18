// Copied from the prototype's src/web/tui/core.ts at 44c6d4a, whole, unchanged.
/**
 * The part of @opentui/core the game uses, in plain JavaScript for the browser (OpenTUI's own
 * renderer, layout and text are native Zig). The static build aliases "@opentui/core" here; the
 * terminal game keeps the real one.
 */

export { ASCIIFontRenderable, measureText, registerFont, type ASCIIFontOptions } from "./ascii-font.ts";
export { BoxRenderable, type BoxOptions } from "./box.ts";
export { BORDER_CHARS, OptimizedBuffer, type BorderStyle } from "./buffer.ts";
export { EventEmitter, KeyEvent, KeyHandler, MouseButton, MouseEvent, parseKeypress, PasteEvent } from "./events.ts";
export { InputRenderable, InputRenderableEvents, type InputRenderableOptions } from "./input.ts";
export { BaseRenderable, isRenderable, Renderable, RootRenderable, type RenderableOptions, type RenderContext } from "./renderable.ts";
export { CliRenderer, CliRenderEvents, createCliRenderer, type CliRendererConfig, type TerminalIO } from "./renderer.ts";
export { hexToRgb, parseColor, RGBA, type ColorInput } from "./rgba.ts";
export { ScrollBoxRenderable, ScrollBarRenderable, SliderRenderable, type ScrollBoxOptions } from "./scrollbox.ts";
export { TextareaRenderable, type TextareaOptions } from "./textarea.ts";
export { isTextNodeRenderable, RootTextNodeRenderable, TextNodeRenderable, TextRenderable, type TextChunk, type TextOptions } from "./text.ts";
export { stringWidth } from "./width.ts";

import fonts from "virtual:opentui-fonts";
import { registerFont, type FontDefinition } from "./ascii-font.ts";

for (const [name, font] of Object.entries(fonts)) registerFont(name, font as FontDefinition);

export const TextAttributes = {
  NONE: 0,
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  INVERSE: 1 << 5,
  HIDDEN: 1 << 6,
  STRIKETHROUGH: 1 << 7,
} as const;
