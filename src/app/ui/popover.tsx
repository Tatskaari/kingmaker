import type { MouseEvent } from "@opentui/core";
import { knowledgeCard } from "../../runtime/knowledge.ts";
import type { Game } from "../game.ts";
import { C, MARK_LABEL } from "../theme.ts";
import { BOLD, Keys, wrap, type KeyHint } from "./common.tsx";
import { sceneSide } from "./scene.tsx";

/**
 * A marked phrase, opened (a click on it, or Enter on what Tab picked out): the phrase in its kind's
 * colour, the GM's note on it, and, where the mark is about something the player knows (someone, a
 * place or custom anyone could read about, something they did), what they know of it
 * (src/runtime/knowledge.ts: never what's behind the GM's screen). It opens by the phrase, inside
 * the conversation's column, and closes with Esc or a click outside it; Tab goes on to the reply's
 * next mark.
 */
export function MarkPopover({ game, at, width, height }: { game: Game; at: { line: number; mark: number; x?: number | undefined; y?: number | undefined }; width: number; height: number }) {
  const line = game.lines[at.line];
  const mark = line?.marked?.marks[at.mark];
  if (!line || !mark) return null;
  const close = () => game.closeOverlay();
  const count = line.marked?.marks.length ?? 0;
  const session = game.session;
  const card = mark.link && session ? knowledgeCard(session, mark.link) : undefined;
  // The conversation's column, above the box: the popover never covers the place or what's typed.
  const area = { w: Math.max(30, width - sceneSide(width)), h: Math.max(8, height - 4) };
  const w = Math.min(60, area.w - 2);
  const inner = w - 4;
  const rows: Array<{ text: string; fg: string; bold?: boolean }> = [
    ...wrap(`“${line.text.slice(mark.start, mark.end).replace(/^[“"]|[”"]$/g, "")}”`, inner).map(text => ({ text, fg: C[mark.kind], bold: true })),
    { text: "", fg: C.text },
    ...wrap(mark.note, inner).map(text => ({ text, fg: C.text })),
    ...(card && card.lines.length ? [{ text: "", fg: C.text }, ...wrap(card.title, inner).map(text => ({ text, fg: C.title, bold: true })), ...card.lines.flatMap(l => wrap(l, inner).map(text => ({ text, fg: C.dim })))] : []),
  ].slice(0, area.h - 3);
  const h = rows.length + 3;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  // By the phrase that was clicked: below it, or above it when there's no room; else over the end of the conversation.
  const left = clamp(at.x !== undefined ? at.x - 2 : Math.floor((area.w - w) / 2), 0, Math.max(0, area.w - w));
  const top = at.y === undefined ? Math.max(0, area.h - h - 1) : at.y + 1 + h <= area.h ? at.y + 1 : Math.max(0, at.y - h);
  const keys: KeyHint[] = [["Esc", "close", close], ...(count > 1 ? [["Tab", "the next", () => game.stepMark(1)] as KeyHint] : [])];
  return <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0 || e.button === 2) close(); }} />
    <box position="absolute" left={left} top={top} width={w} height={h} zIndex={100} border borderStyle="rounded" borderColor={C[mark.kind]}
      backgroundColor={C.panel} title={` ${MARK_LABEL[mark.kind]} `} titleAlignment="left" titleColor={C[mark.kind]} paddingX={1} flexDirection="column"
      onMouseDown={(e: MouseEvent) => e.stopPropagation()}>
      {rows.map((r, i) => <text key={i} height={1} flexShrink={0} fg={r.fg} {...(r.bold ? { attributes: BOLD } : {})}>{r.text || " "}</text>)}
      <Keys items={keys} gap=" · " />
    </box>
  </>;
}
