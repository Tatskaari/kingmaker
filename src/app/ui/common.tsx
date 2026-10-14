import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import type { StyledLine } from "../../game/types.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";

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

/** A key hint line: "e interact · c sheet". */
export function Keys({ items }: { items: Array<[string, string]> }) {
  // One flat run of spans: nested spans don't measure reliably.
  const spans = items.flatMap(([key, what], i) => [
    <span key={`k${i}`} fg={C.title}>{key}</span>,
    <span key={`w${i}`} fg={C.dim}>{` ${what}${i < items.length - 1 ? "  ·  " : ""}`}</span>,
  ]);
  return <text flexShrink={0} height={1}>{spans}</text>;
}
