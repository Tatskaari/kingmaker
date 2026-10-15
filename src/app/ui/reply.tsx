import { MouseButton, TextAttributes, type MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";
import type { Markup } from "../../runtime/markup.ts";
import { replyRows, type Run, type Style } from "../reply.ts";

/**
 * A GM reply as the player reads it (src/app/reply.ts lays it out): narration, each person's lines
 * in their colour, paragraphs broken where the speaker or the kind of text changes, and the marked
 * phrases underlined in their kind's colour. A marked phrase is its own piece of text on its row,
 * so the mouse knows it: pointing at it says what it is (`onPoint`), a click opens it (`onOpen`).
 */
export interface ReplyProps {
  text: string;
  markup: Markup;
  /** The columns it has. */
  width: number;
  style: Style;
  /** Still streaming in: a cursor after the last word. */
  cursor?: string | undefined;
  onOpen?: (mark: number, x: number, y: number) => void;
  onPoint?: (mark: number | undefined) => void;
}

const attributesOf = (r: Run) => (r.underline ? TextAttributes.UNDERLINE : 0) | (r.bold ? TextAttributes.BOLD : 0);

const span = (r: Run, key: number) => <span key={key} fg={r.fg} {...(r.bg ? { bg: r.bg } : {})} {...(attributesOf(r) ? { attributes: attributesOf(r) } : {})}>{r.text}</span>;

export function Reply({ text, markup, width, style, cursor, onOpen, onPoint }: ReplyProps) {
  const rows = replyRows(text, markup, width, style);
  return <box flexDirection="column" flexShrink={0}>
    {rows.map((row, i) => {
      const end = cursor && i === rows.length - 1 ? <span fg={cursor}>▍</span> : null;
      if (!row.length) return <text key={i} height={1} flexShrink={0}>{end ?? " "}</text>;
      if (!row.some(r => r.mark !== undefined)) return <text key={i} height={1} flexShrink={0}>{row.map(span)}{end}</text>;
      // A row with a mark in it: the mark is a piece of text of its own, for the mouse.
      const groups: Array<{ mark?: number; runs: Run[] }> = [];
      for (const r of row) {
        const last = groups.at(-1);
        if (last && last.mark === r.mark) last.runs.push(r);
        else groups.push({ ...(r.mark !== undefined ? { mark: r.mark } : {}), runs: [r] });
      }
      const parts: ReactNode[] = groups.map((g, j) => {
        const m = g.mark;
        if (m === undefined) return <text key={j} flexShrink={0}>{g.runs.map(span)}</text>;
        return <text key={j} flexShrink={0}
          onMouseDown={(e: MouseEvent) => { if (e.button !== MouseButton.LEFT && e.button !== MouseButton.RIGHT) return; e.stopPropagation(); onOpen?.(m, e.x, e.y); }}
          onMouseOver={() => onPoint?.(m)} onMouseOut={() => onPoint?.(undefined)}>{g.runs.map(span)}</text>;
      });
      return <box key={i} flexDirection="row" height={1} flexShrink={0}>{parts}{end ? <text flexShrink={0}>{end}</text> : null}</box>;
    })}
  </box>;
}
