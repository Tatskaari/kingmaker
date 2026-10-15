/**
 * Colours as OpenTUI has them (@opentui/core's lib/RGBA.ts, MIT): four channels of eight bits, each
 * in the low byte of a Uint16 with the colour's intent in the high bytes, and the same parser for
 * "#rgb", "#rrggbb", "#rrggbbaa", CSS names and "transparent".
 */

export type ColorInput = string | RGBA;

const INTENT_RGB = 0;
const ZERO = new Uint16Array(4);

const toU8 = (value: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255);
const toByte = (value: number) => Math.round(Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0)));
const packMeta = (intent: number, slot = 0) => ((slot & 0xff) | ((intent & 0xff) << 8)) >>> 0;

function packRGBA8(r: number, g: number, b: number, a: number, meta: number): RGBA {
  const rgba = new RGBA(ZERO);
  rgba.buffer[0] = (toByte(r) & 0xff) | (((meta >>> 0) & 0xff) << 8);
  rgba.buffer[1] = (toByte(g) & 0xff) | (((meta >>> 8) & 0xff) << 8);
  rgba.buffer[2] = (toByte(b) & 0xff) | (((meta >>> 16) & 0xff) << 8);
  rgba.buffer[3] = (toByte(a) & 0xff) | (((meta >>> 24) & 0xff) << 8);
  return rgba;
}

export class RGBA {
  buffer: Uint16Array;

  constructor(buffer: Uint16Array) {
    const copy = new Uint16Array(4);
    copy.set(buffer.subarray(0, 4));
    this.buffer = copy;
  }

  static fromArray(array: Uint16Array): RGBA { return new RGBA(array); }
  static fromValues(r: number, g: number, b: number, a = 1): RGBA { return packRGBA8(toU8(r), toU8(g), toU8(b), toU8(a), packMeta(INTENT_RGB)); }
  static fromInts(r: number, g: number, b: number, a = 255): RGBA { return packRGBA8(r, g, b, a, packMeta(INTENT_RGB)); }
  static fromHex(hex: string): RGBA { return hexToRgb(hex); }
  static clone(rgba: RGBA): RGBA { return new RGBA(rgba.buffer); }

  toInts(): [number, number, number, number] {
    return [this.buffer[0]! & 0xff, this.buffer[1]! & 0xff, this.buffer[2]! & 0xff, this.buffer[3]! & 0xff];
  }

  get r(): number { return (this.buffer[0]! & 0xff) / 255; }
  set r(value: number) { this.buffer[0] = (this.buffer[0]! & 0xff00) | toU8(value); }
  get g(): number { return (this.buffer[1]! & 0xff) / 255; }
  set g(value: number) { this.buffer[1] = (this.buffer[1]! & 0xff00) | toU8(value); }
  get b(): number { return (this.buffer[2]! & 0xff) / 255; }
  set b(value: number) { this.buffer[2] = (this.buffer[2]! & 0xff00) | toU8(value); }
  get a(): number { return (this.buffer[3]! & 0xff) / 255; }
  set a(value: number) { this.buffer[3] = (this.buffer[3]! & 0xff00) | toU8(value); }

  /** The colour packed into one number for the cell buffer: 0xRRGGBBAA. */
  get packed(): number {
    return (((this.buffer[0]! & 0xff) << 24) | ((this.buffer[1]! & 0xff) << 16) | ((this.buffer[2]! & 0xff) << 8) | (this.buffer[3]! & 0xff)) >>> 0;
  }

  map<R>(fn: (value: number) => R): [R, R, R, R] { return [fn(this.r), fn(this.g), fn(this.b), fn(this.a)]; }
  toString(): string { return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`; }
  equals(other?: RGBA): boolean {
    return !!other && this.buffer[0] === other.buffer[0] && this.buffer[1] === other.buffer[1] && this.buffer[2] === other.buffer[2] && this.buffer[3] === other.buffer[3];
  }
}

export function hexToRgb(input: string): RGBA {
  let hex = input.replace(/^#/, "");
  if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
  else if (hex.length === 4) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]! + hex[3]! + hex[3]!;
  if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[0-9A-Fa-f]{8}$/.test(hex)) {
    console.warn(`Invalid hex color: ${hex}, defaulting to magenta`);
    return RGBA.fromValues(1, 0, 1, 1);
  }
  const r = parseInt(hex.substring(0, 2), 16), g = parseInt(hex.substring(2, 4), 16), b = parseInt(hex.substring(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) : 255;
  return RGBA.fromInts(r, g, b, a);
}

const CSS_COLOR_NAMES: Record<string, string> = {
  black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#008000", blue: "#0000FF", yellow: "#FFFF00", cyan: "#00FFFF",
  magenta: "#FF00FF", silver: "#C0C0C0", gray: "#808080", grey: "#808080", maroon: "#800000", olive: "#808000", lime: "#00FF00",
  aqua: "#00FFFF", teal: "#008080", navy: "#000080", fuchsia: "#FF00FF", purple: "#800080", orange: "#FFA500",
  brightblack: "#666666", brightred: "#FF6666", brightgreen: "#66FF66", brightblue: "#6666FF", brightyellow: "#FFFF66",
  brightcyan: "#66FFFF", brightmagenta: "#FF66FF", brightwhite: "#FFFFFF",
};

/** A colour from a string or an RGBA (returned as is, as OpenTUI does). */
export function parseColor(color: ColorInput): RGBA {
  if (typeof color !== "string") return color;
  const lower = color.toLowerCase();
  if (lower === "transparent") return RGBA.fromValues(0, 0, 0, 0);
  const named = CSS_COLOR_NAMES[lower];
  return hexToRgb(named ?? color);
}

/** A packed colour (0xRRGGBBAA) from a string or an RGBA. */
export const packedColor = (color: ColorInput): number => parseColor(color).packed;

export const TRANSPARENT = 0;
export const WHITE = 0xffffffff;
export const alphaOf = (c: number) => c & 0xff;
