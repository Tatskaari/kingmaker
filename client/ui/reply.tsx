// Copied from the prototype's src/app/ui/reply.tsx at 44c6d4a, but its marked phrases (the notes', which M2 took out of the game: docs/two-part-design.md): Markup comes from shared/markup.ts.
import { TextAttributes } from "@opentui/core";
import type { Markup } from "../../shared/markup.ts";
import { replyRows, type Run, type Style } from "../reply.ts";

/**
 * A GM reply as the player reads it (client/reply.ts lays it out): narration, each person's lines
 * in their colour, paragraphs broken where the speaker or the kind of text changes.
 */
export interface ReplyProps {
  text: string;
  markup: Markup;
  /** The columns it has. */
  width: number;
  style: Style;
  /** Still streaming in: a cursor after the last word. */
  cursor?: string | undefined;
}

const attributesOf = (r: Run) => (r.underline ? TextAttributes.UNDERLINE : 0) | (r.bold ? TextAttributes.BOLD : 0) | (r.italic ? TextAttributes.ITALIC : 0);

const span = (r: Run, key: number) => <span key={key} fg={r.fg} {...(r.bg ? { bg: r.bg } : {})} {...(attributesOf(r) ? { attributes: attributesOf(r) } : {})}>{r.text}</span>;

export function Reply({ text, markup, width, style, cursor }: ReplyProps) {
  const rows = replyRows(text, markup, width, style);
  return <box flexDirection="column" flexShrink={0}>
    {rows.map((row, i) => {
      const end = cursor && i === rows.length - 1 ? <span fg={cursor}>▍</span> : null;
      if (!row.length) return <text key={i} height={1} flexShrink={0}>{end ?? " "}</text>;
      return <text key={i} height={1} flexShrink={0}>{row.map(span)}{end}</text>;
    })}
  </box>;
}
