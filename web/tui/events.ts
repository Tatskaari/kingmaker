// Copied from the prototype's src/web/tui/events.ts at 44c6d4a, whole, unchanged.
/**
 * Input as OpenTUI turns it into events (@opentui/core's KeyHandler.ts, parse.keypress.ts,
 * parse.mouse.ts and stdin-parser.ts, MIT): bytes from the terminal split into keys, SGR mouse
 * reports and bracketed pastes; keys parsed into KeyEvents; and the key handler that gives global
 * listeners (useKeyboard) a key first and the focused renderable after, unless prevented.
 */

// ---------------------------------------------------------------------------------------------
// A small EventEmitter (the browser has no node:events).

type Listener = (...args: any[]) => void;

export class EventEmitter {
  private _events = new Map<string | symbol, Listener[]>();

  on(event: string | symbol, listener: Listener): this { return this.addListener(event, listener); }
  addListener(event: string | symbol, listener: Listener): this {
    const list = this._events.get(event) ?? [];
    list.push(listener);
    this._events.set(event, list);
    return this;
  }
  prependListener(event: string | symbol, listener: Listener): this {
    this._events.set(event, [listener, ...(this._events.get(event) ?? [])]);
    return this;
  }
  once(event: string | symbol, listener: Listener): this {
    const wrapped: Listener & { listener?: Listener } = (...args) => { this.off(event, wrapped); listener(...args); };
    wrapped.listener = listener;
    return this.on(event, wrapped);
  }
  off(event: string | symbol, listener: Listener): this { return this.removeListener(event, listener); }
  removeListener(event: string | symbol, listener: Listener): this {
    const list = this._events.get(event);
    if (!list) return this;
    const i = list.findIndex(l => l === listener || (l as { listener?: Listener }).listener === listener);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this._events.delete(event);
    return this;
  }
  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this._events.clear();
    else this._events.delete(event);
    return this;
  }
  listeners(event: string | symbol): Listener[] { return [...(this._events.get(event) ?? [])]; }
  rawListeners(event: string | symbol): Listener[] { return this.listeners(event); }
  listenerCount(event: string | symbol): number { return this._events.get(event)?.length ?? 0; }
  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this._events.get(event);
    if (!list?.length) return false;
    for (const l of [...list]) l(...args);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Keys

export interface ParsedKey {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;
  number: boolean;
  raw: string;
  eventType: "press" | "repeat" | "release";
  source: "raw" | "kitty";
  code?: string;
  super?: boolean;
  hyper?: boolean;
  capsLock?: boolean;
  numLock?: boolean;
  baseCode?: number;
  repeated?: boolean;
}

export class KeyEvent implements ParsedKey {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;
  number: boolean;
  raw: string;
  eventType: "press" | "repeat" | "release";
  source: "raw" | "kitty";
  code?: string;
  super?: boolean;
  hyper?: boolean;
  capsLock?: boolean;
  numLock?: boolean;
  baseCode?: number;
  repeated?: boolean;
  private _defaultPrevented = false;
  private _propagationStopped = false;

  constructor(key: ParsedKey) {
    this.name = key.name;
    this.ctrl = key.ctrl;
    this.meta = key.meta;
    this.shift = key.shift;
    this.option = key.option;
    this.sequence = key.sequence;
    this.number = key.number;
    this.raw = key.raw;
    this.eventType = key.eventType;
    this.source = key.source;
    if (key.code !== undefined) this.code = key.code;
    if (key.super !== undefined) this.super = key.super;
    if (key.hyper !== undefined) this.hyper = key.hyper;
  }

  get defaultPrevented(): boolean { return this._defaultPrevented; }
  get propagationStopped(): boolean { return this._propagationStopped; }
  preventDefault(): void { this._defaultPrevented = true; }
  stopPropagation(): void { this._propagationStopped = true; }
}

export class PasteEvent {
  readonly type = "paste";
  readonly bytes: Uint8Array;
  readonly metadata: unknown;
  private _defaultPrevented = false;
  private _propagationStopped = false;
  constructor(bytes: Uint8Array, metadata?: unknown) { this.bytes = bytes; this.metadata = metadata; }
  get defaultPrevented(): boolean { return this._defaultPrevented; }
  get propagationStopped(): boolean { return this._propagationStopped; }
  preventDefault(): void { this._defaultPrevented = true; }
  stopPropagation(): void { this._propagationStopped = true; }
}

/** Global listeners (useKeyboard) first, in order; then the focused renderable's, unless prevented or stopped. */
export class KeyHandler extends EventEmitter {
  private renderableHandlers = new Map<string, Set<Listener>>();

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    const keyEvent = args[0] as { propagationStopped?: boolean; defaultPrevented?: boolean } | undefined;
    const isKey = event === "keypress" || event === "keyrelease" || event === "paste";
    let handled = false;
    for (const listener of this.listeners(event)) {
      handled = true;
      try { listener(...args); } catch (error) { console.error(`[KeyHandler] Error in global ${String(event)} handler:`, error); }
      if (isKey && keyEvent?.propagationStopped) return true;
    }
    const set = typeof event === "string" ? this.renderableHandlers.get(event) : undefined;
    if (set?.size) {
      handled = true;
      if (isKey && (keyEvent?.defaultPrevented || keyEvent?.propagationStopped)) return true;
      for (const handler of [...set]) {
        try { handler(...args); } catch (error) { console.error(`[KeyHandler] Error in renderable ${String(event)} handler:`, error); }
        if (isKey && keyEvent?.propagationStopped) return true;
      }
    }
    return handled;
  }

  onInternal(event: string, handler: Listener): void {
    const set = this.renderableHandlers.get(event) ?? new Set();
    set.add(handler);
    this.renderableHandlers.set(event, set);
  }

  offInternal(event: string, handler: Listener): void {
    this.renderableHandlers.get(event)?.delete(handler);
  }

  processParsedKey(key: ParsedKey): void {
    this.emit(key.eventType === "release" ? "keyrelease" : "keypress", new KeyEvent(key));
  }

  processPaste(bytes: Uint8Array): void {
    this.emit("paste", new PasteEvent(bytes));
  }
}

const KEY_NAMES: Record<string, string> = {
  OP: "f1", OQ: "f2", OR: "f3", OS: "f4", "[11~": "f1", "[12~": "f2", "[13~": "f3", "[14~": "f4", "[[A": "f1", "[[B": "f2", "[[C": "f3",
  "[[D": "f4", "[[E": "f5", "[15~": "f5", "[17~": "f6", "[18~": "f7", "[19~": "f8", "[20~": "f9", "[21~": "f10", "[23~": "f11", "[24~": "f12",
  "[29~": "menu", "[57427~": "clear", "[A": "up", "[B": "down", "[C": "right", "[D": "left", "[E": "clear", "[F": "end", "[H": "home",
  "[P": "f1", "[Q": "f2", "[S": "f4", OA: "up", OB: "down", OC: "right", OD: "left", OE: "clear", OF: "end", OH: "home", OM: "return",
  Oj: "*", Ok: "+", Ol: ",", Om: "-", On: ".", Oo: "/", Op: "0", Oq: "1", Or: "2", Os: "3", Ot: "4", Ou: "5", Ov: "6", Ow: "7", Ox: "8",
  Oy: "9", OX: "=", "[1~": "home", "[2~": "insert", "[3~": "delete", "[4~": "end", "[5~": "pageup", "[6~": "pagedown", "[[5~": "pageup",
  "[[6~": "pagedown", "[7~": "home", "[8~": "end", "[a": "up", "[b": "down", "[c": "right", "[d": "left", "[e": "clear", f: "right",
  b: "left", p: "up", n: "down", "[2$": "insert", "[3$": "delete", "[5$": "pageup", "[6$": "pagedown", "[7$": "home", "[8$": "end",
  Oa: "up", Ob: "down", Oc: "right", Od: "left", Oe: "clear", "[2^": "insert", "[3^": "delete", "[5^": "pageup", "[6^": "pagedown",
  "[7^": "home", "[8^": "end", "[Z": "tab",
};
const SHIFT_CODES = new Set(["[a", "[b", "[c", "[d", "[e", "[2$", "[3$", "[5$", "[6$", "[7$", "[8$", "[Z"]);
const CTRL_CODES = new Set(["Oa", "Ob", "Oc", "Od", "Oe", "[2^", "[3^", "[5^", "[6^", "[7^", "[8^"]);
const SS3_PRINTABLE: Record<string, string> = { Op: "0", Oq: "1", Or: "2", Os: "3", Ot: "4", Ou: "5", Ov: "6", Ow: "7", Ox: "8", Oy: "9", Oj: "*", Ok: "+", Ol: ",", Om: "-", On: ".", Oo: "/", OX: "=" };
const META_KEY_RE = /^(?:\x1b)([a-zA-Z0-9])$/;
const FN_KEY_RE = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;
const MODIFY_OTHER_KEYS_RE = /^\x1b\[27;(\d+);(\d+)~$/;

function ctrlKeyName(code: number): string | undefined {
  if (code === 0) return "space";
  if (code >= 1 && code <= 26) return String.fromCharCode(code + 96);
  if (code >= 28 && code <= 31) return String.fromCharCode(code + 64);
  return undefined;
}

/** parseKeypress (legacy terminals; xterm.js speaks no kitty protocol): a key from its sequence, or null for a terminal report. */
export function parseKeypress(s: string): ParsedKey | null {
  if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(s) || /^\x1b\[\d+;\d+R$/.test(s) || /^\x1b\[\?[\d;]+c$/.test(s) || s === "\x1b[I" || s === "\x1b[O" || s === "\x1b[200~" || s === "\x1b[201~") return null;
  const key: ParsedKey = { name: "", ctrl: false, meta: false, shift: false, option: false, number: false, sequence: s, raw: s, eventType: "press", source: "raw" };
  const ctrlName = s.length === 1 ? ctrlKeyName(s.charCodeAt(0)) : undefined;
  const metaCtrlName = s.length === 2 && s[0] === "\x1b" ? ctrlKeyName(s.charCodeAt(1)) : undefined;
  const other = MODIFY_OTHER_KEYS_RE.exec(s);
  let parts: RegExpExecArray | null;
  if (other) {
    const modifier = parseInt(other[1]!, 10) - 1;
    const charCode = parseInt(other[2]!, 10);
    key.ctrl = !!(modifier & 4); key.meta = !!(modifier & 2); key.shift = !!(modifier & 1); key.option = !!(modifier & 2);
    key.super = !!(modifier & 8); key.hyper = !!(modifier & 16);
    if (charCode === 13) key.name = "return";
    else if (charCode === 27) key.name = "escape";
    else if (charCode === 9) key.name = "tab";
    else if (charCode === 32) key.name = "space";
    else if (charCode === 127 || charCode === 8) key.name = "backspace";
    else { const ch = String.fromCharCode(charCode); key.name = ch; key.sequence = ch; if (charCode >= 48 && charCode <= 57) key.number = true; }
    return key;
  }
  if (s === "\r" || s === "\x1b\r") { key.name = "return"; key.meta = s.length === 2; }
  else if (s === "\n" || s === "\x1b\n") { key.name = "linefeed"; key.meta = s.length === 2; }
  else if (s === "\t") key.name = "tab";
  else if (s === "\b" || s === "\x1b\b" || s === "\x7f" || s === "\x1b\x7f") { key.name = "backspace"; key.meta = s.charAt(0) === "\x1b"; }
  else if (s === "\x1b" || s === "\x1b\x1b") { key.name = "escape"; key.meta = s.length === 2; }
  else if (s === " " || s === "\x1b ") { key.name = "space"; key.meta = s.length === 2; }
  else if (ctrlName) { key.name = ctrlName; key.ctrl = true; }
  else if (s.length === 1 && s >= "0" && s <= "9") { key.name = s; key.number = true; }
  else if (s.length === 1 && s >= "a" && s <= "z") key.name = s;
  else if (s.length === 1 && s >= "A" && s <= "Z") { key.name = s.toLowerCase(); key.shift = true; }
  else if (s.length === 1 || (s.length === 2 && s.codePointAt(0)! > 0xffff)) key.name = s;
  else if ((parts = META_KEY_RE.exec(s))) {
    key.meta = true;
    const ch = parts[1]!;
    if (ch === "F") key.name = "right";
    else if (ch === "B") key.name = "left";
    else if (/^[A-Z]$/.test(ch)) { key.shift = true; key.name = ch; }
    else key.name = ch;
  } else if (metaCtrlName) { key.meta = true; key.ctrl = true; key.name = metaCtrlName; }
  else if ((parts = FN_KEY_RE.exec(s))) {
    const segs = [...s];
    if (segs[0] === "\x1b" && segs[1] === "\x1b") { key.option = true; key.meta = true; }
    const code = [parts[1], parts[2], parts[4], parts[6]].filter(Boolean).join("");
    const modifier = parseInt(parts[3] || parts[5] || "1", 10) - 1;
    key.ctrl ||= !!(modifier & 4); key.meta ||= !!(modifier & 2); key.shift ||= !!(modifier & 1); key.option ||= !!(modifier & 2);
    key.super = !!(modifier & 8); key.hyper = !!(modifier & 16);
    key.code = code;
    const name = KEY_NAMES[code];
    if (name) {
      key.name = name;
      key.shift = SHIFT_CODES.has(code) || key.shift;
      key.ctrl = CTRL_CODES.has(code) || key.ctrl;
      const printable = SS3_PRINTABLE[code];
      if (printable !== undefined) { key.sequence = printable; if (key.name >= "0" && key.name <= "9") key.number = true; }
    } else { key.name = ""; delete key.code; }
  } else if (s === "\x1b[3~") { key.name = "delete"; key.meta = false; key.code = "[3~"; }
  return key;
}

// ---------------------------------------------------------------------------------------------
// The mouse

export const MouseButton = { LEFT: 0, MIDDLE: 1, RIGHT: 2, WHEEL_UP: 4, WHEEL_DOWN: 5 } as const;
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

export type MouseEventType = "down" | "up" | "move" | "drag" | "drag-end" | "drop" | "over" | "out" | "scroll";

export interface RawMouseEvent {
  type: MouseEventType;
  button: number;
  x: number;
  y: number;
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
  scroll?: { direction: "up" | "down" | "left" | "right"; delta: number } | undefined;
  source?: unknown;
  isDragging?: boolean;
}

export class MouseEvent {
  readonly type: MouseEventType;
  readonly button: number;
  readonly x: number;
  readonly y: number;
  readonly source?: unknown;
  readonly modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
  readonly scroll?: { direction: "up" | "down" | "left" | "right"; delta: number } | undefined;
  readonly target: unknown;
  currentTarget: unknown = null;
  readonly isDragging?: boolean | undefined;
  private _propagationStopped = false;
  private _defaultPrevented = false;

  constructor(target: unknown, attributes: RawMouseEvent) {
    this.target = target;
    this.type = attributes.type;
    this.button = attributes.button;
    this.x = attributes.x;
    this.y = attributes.y;
    this.modifiers = attributes.modifiers;
    this.scroll = attributes.scroll;
    this.source = attributes.source;
    this.isDragging = attributes.isDragging;
  }

  get propagationStopped(): boolean { return this._propagationStopped; }
  get defaultPrevented(): boolean { return this._defaultPrevented; }
  stopPropagation(): void { this._propagationStopped = true; }
  preventDefault(): void { this._defaultPrevented = true; }
}

const SCROLL_DIRECTIONS = ["up", "down", "left", "right"] as const;

/** MouseParser.decodeSgrEvent: an SGR report (\x1b[<b;x;yM or m) as an event, tracking pressed buttons for drags. */
export class MouseParser {
  private pressed = new Set<number>();
  reset(): void { this.pressed.clear(); }

  parse(sequence: string): RawMouseEvent | null {
    const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(sequence);
    if (!m) return null;
    const raw = Number(m[1]), wireX = Number(m[2]), wireY = Number(m[3]), pressRelease = m[4]!;
    const button = raw & 3;
    const isScroll = (raw & 64) !== 0;
    const isMotion = (raw & 32) !== 0;
    const modifiers = { shift: (raw & 4) !== 0, alt: (raw & 8) !== 0, ctrl: (raw & 16) !== 0 };
    let type: MouseEventType;
    let scroll: RawMouseEvent["scroll"];
    if (isMotion) type = button === 3 ? "move" : this.pressed.size > 0 ? "drag" : "move";
    else if (isScroll && pressRelease === "M") { type = "scroll"; scroll = { direction: SCROLL_DIRECTIONS[button]!, delta: 1 }; }
    else {
      type = pressRelease === "M" ? "down" : "up";
      if (type === "down" && button !== 3) this.pressed.add(button);
      else if (type === "up") this.pressed.delete(button);
    }
    return { type, button: button === 3 ? 0 : button, x: wireX - 1, y: wireY - 1, modifiers, scroll };
  }
}

// ---------------------------------------------------------------------------------------------
// Splitting the terminal's bytes

export type InputEvent = { type: "key"; sequence: string } | { type: "mouse"; sequence: string } | { type: "paste"; text: string } | { type: "response"; sequence: string };

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Splits what the terminal sends into keys, mouse reports, pastes and other reports. The page's
 * terminal sends whole sequences in each message, so an escape at the end of one is the Esc key.
 */
export class InputSplitter {
  private paste: string | undefined;
  private decoder = new TextDecoder();

  push(bytes: Uint8Array | string): InputEvent[] {
    const s = typeof bytes === "string" ? bytes : this.decoder.decode(bytes, { stream: true });
    const out: InputEvent[] = [];
    let i = 0;
    while (i < s.length) {
      if (this.paste !== undefined) {
        const end = s.indexOf(PASTE_END, i);
        if (end < 0) { this.paste += s.slice(i); return out; }
        this.paste += s.slice(i, end);
        out.push({ type: "paste", text: this.paste });
        this.paste = undefined;
        i = end + PASTE_END.length;
        continue;
      }
      if (s.startsWith(PASTE_START, i)) { this.paste = ""; i += PASTE_START.length; continue; }
      const ch = s[i]!;
      if (ch !== "\x1b") {
        const cp = s.codePointAt(i)!;
        const len = cp > 0xffff ? 2 : 1;
        out.push({ type: "key", sequence: s.slice(i, i + len) });
        i += len;
        continue;
      }
      // An escape sequence; ESC before one is Alt (meta) with it.
      const meta = s[i + 1] === "\x1b" && (s[i + 2] === "[" || s[i + 2] === "O");
      const start = meta ? i + 1 : i;
      const event = readEscape(s, start);
      i = start + event.sequence.length;
      if (meta && event.type === "key") event.sequence = `\x1b${event.sequence}`;
      out.push(event);
    }
    return out;
  }
}

/** The escape sequence at s[i] (s[i] is ESC). */
function readEscape(s: string, i: number): { type: "key" | "mouse" | "response"; sequence: string } {
  const next = s[i + 1];
  if (next === undefined) return { type: "key", sequence: "\x1b" };
  if (next === "[") {
    // CSI: parameters and intermediates, then a final byte. SGR mouse reports are \x1b[<b;x;yM or m.
    let j = i + 2;
    if (s[j] === "[") j++; // \x1b[[A, the Linux console's F-keys
    while (j < s.length && /[0-9;:<=>?]/.test(s[j]!)) j++;
    while (j < s.length && /[ -/$]/.test(s[j]!)) j++;
    if (j >= s.length) return { type: "key", sequence: s.slice(i) };
    const seq = s.slice(i, j + 1);
    if (seq.startsWith("\x1b[<")) return { type: "mouse", sequence: seq };
    if (/^\x1b\[\d+;\d+R$/.test(seq) || /^\x1b\[\?[\d;]*[cnuy]$/.test(seq) || seq === "\x1b[I" || seq === "\x1b[O") return { type: "response", sequence: seq };
    return { type: "key", sequence: seq };
  }
  if (next === "O") return { type: "key", sequence: s.slice(i, Math.min(s.length, i + 3)) };
  if (next === "]" || next === "P" || next === "_") {
    // OSC, DCS and APC reports run to BEL or ST.
    const bel = s.indexOf("\x07", i);
    const st = s.indexOf("\x1b\\", i + 2);
    const end = bel >= 0 && (st < 0 || bel < st) ? bel + 1 : st >= 0 ? st + 2 : s.length;
    return { type: "response", sequence: s.slice(i, end) };
  }
  if (next === "\x1b") return { type: "key", sequence: "\x1b\x1b" };
  // Alt and a character.
  const cp = s.codePointAt(i + 1)!;
  return { type: "key", sequence: s.slice(i, i + 1 + (cp > 0xffff ? 2 : 1)) };
}
