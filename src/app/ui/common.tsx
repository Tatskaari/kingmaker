import { TextAttributes, type KeyEvent, type MouseEvent } from "@opentui/core";
import type { BoxProps } from "@opentui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StyledLine } from "../../game/types.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";

/** The Enter key, however the terminal sends it. */
export const isEnter = (key: KeyEvent) => key.name === "return" || key.name === "enter" || key.name === "kpenter";

/** A key that types (a character, a space, a backspace) rather than one that does something (Enter, Esc, the arrows, PgUp). */
export const isTyped = (key: KeyEvent) => !key.ctrl && !key.meta && (key.name === "space" || key.name === "backspace" || (key.sequence?.length === 1 && key.sequence >= " " && key.sequence !== "\x7f"));

/**
 * A key on a way on (a scene that's over, the moment between scenes), where the player may still be
 * typing their next line: only an Enter of its own goes on ("go"). A typed character never does
 * ("typed"), and the Enter that ends what was being typed only ends that line ("line"; game.typing
 * keeps track): so a line typed as a scene ends doesn't carry the player past its last word, through
 * the moment between scenes and out onto the map, where the rest of it would walk. Clicks go on.
 */
export function wayOnKey(game: Game, key: KeyEvent): "go" | "line" | "typed" | undefined {
  if (isEnter(key)) {
    if (!game.typing) return "go";
    game.typing = false;
    return "line";
  }
  if (isTyped(key)) { game.typing = true; return "typed"; }
  return undefined;
}

/**
 * The world's views (the town, a scene's place, a fight) animate on their own at about this many
 * frames a second: live canvases that paint the map at the time they're drawn (water runs, fire
 * flickers, effects play), while the rest of the screen redraws only when the game changes.
 */
export const FPS = 12;

/**
 * A scrollbox's bar, laid over a column kept free for it (give the scrollbox paddingRight={1}). A bar
 * that takes its own room narrows the text beside it when it appears, and the text doesn't re-wrap:
 * its last column goes under the bar, a character a line.
 */
export const SCROLLBAR = { position: "absolute", right: 0, top: 0, bottom: 0, trackOptions: { foregroundColor: C.border, backgroundColor: C.bg } } as const;

/** Redraw whenever the game changes. */
export function useGame(game: Game): Game {
  const [, setTick] = useState(0);
  useEffect(() => game.subscribe(() => setTick(t => t + 1)), [game]);
  return game;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label, color = C.title }: { label: string; color?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 90);
    return () => clearInterval(timer);
  }, []);
  return <text fg={color}>{`${FRAMES[frame]} ${label}`}</text>;
}

/** Styled lines from a renderer (the map), one <text> a row. */
export function Lines({ lines }: { lines: StyledLine[] }) {
  return <box flexDirection="column" flexShrink={0}>
    {lines.map((line, i) => <text key={i} flexShrink={0}>
      {line.map((s, j) => <span key={j} fg={s.fg ?? C.text} {...(s.bg ? { bg: s.bg } : {})} {...(s.bold ? { attributes: TextAttributes.BOLD } : {})}>{s.text}</span>)}
    </text>)}
  </box>;
}

/** Word-wrap plain text to a width (for fixed-height panels that can't scroll). */
export function wrap(text: string, width: number): string[] {
  width = Math.max(1, Math.floor(width));
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { out.push(line); line = ""; }
      line = line ? `${line} ${word}` : word;
      while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    }
    out.push(line);
  }
  return out;
}

export const BOLD = TextAttributes.BOLD;
export const ITALIC = TextAttributes.ITALIC;
export const DIM = TextAttributes.DIM;

/** A key hint: the key, what it does, and (for the mouse) what a click on it does. */
export type KeyHint = [key: string, what: string] | [key: string, what: string, onClick: () => void];

/** As many key hints as fit a line `width` wide, in order (`gap`: the separator's width). */
export function fit(items: KeyHint[], width: number, gap = 5): KeyHint[] {
  const out: KeyHint[] = [];
  let used = 0;
  for (const item of items) {
    // A key alone ("/sheet") is drawn without a space after it.
    const w = item[0].length + (item[1] ? 1 + item[1].length : 0) + (out.length ? gap : 0);
    if (used + w > width) break;
    out.push(item);
    used += w;
  }
  return out;
}

/** A key hint line: "e interact · c sheet". Hints with a click are buttons too. */
export function Keys({ items, gap = "  ·  " }: { items: KeyHint[]; gap?: string }) {
  const sep = (i: number) => (i < items.length - 1 ? gap : "");
  if (items.some(i => i[2])) {
    return <box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
      {items.map(([key, what, onClick], i) => {
        const hint = <text flexShrink={0}><span fg={C.title}>{key}</span><span fg={C.dim}>{what ? ` ${what}` : ""}</span></text>;
        return <box key={i} flexDirection="row" flexShrink={0}>
          {onClick ? <Clickable onClick={onClick}>{hint}</Clickable> : hint}
          <text flexShrink={0} fg={C.dim}>{sep(i)}</text>
        </box>;
      })}
    </box>;
  }
  // One flat run of spans: nested spans don't measure reliably.
  const spans = items.flatMap(([key, what], i) => [
    <span key={`k${i}`} fg={C.title}>{key}</span>,
    <span key={`w${i}`} fg={C.dim}>{`${what ? ` ${what}` : ""}${sep(i)}`}</span>,
  ]);
  return <text flexShrink={0} height={1}>{spans}</text>;
}

/**
 * Something to click: it lights up under the mouse (`onHover`: and says so), and a left click on it
 * (pressed and let go on it) does it. On the letting go, so the screen it leads to doesn't get half
 * a click.
 */
export function Clickable({ onClick, onHover, children, backgroundColor, ...box }: Omit<BoxProps, "onMouseDown" | "onMouseUp" | "onMouseOver" | "onMouseOut"> & { onClick: () => void; onHover?: () => void; children?: ReactNode }) {
  const [hover, setHover] = useState(false);
  const pressed = useRef(false);
  return <box {...box} {...(hover ? { backgroundColor: C.highlightBg } : backgroundColor ? { backgroundColor } : {})}
    onMouseOver={() => { setHover(true); onHover?.(); }} onMouseOut={() => { setHover(false); pressed.current = false; }}
    onMouseDown={(e: MouseEvent) => { if (e.button === 0) { e.stopPropagation(); pressed.current = true; } }}
    onMouseUp={(e: MouseEvent) => { if (e.button === 0 && pressed.current) { e.stopPropagation(); pressed.current = false; onClick(); } }}>
    {children}
  </box>;
}
