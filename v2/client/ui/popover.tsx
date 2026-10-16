// Copied from the prototype's src/app/ui/popover.tsx at 44c6d4a: it reads a SceneModel in place of the Game, and the knowledge card from the mark (the AI service writes it with the note) in place of knowledgeCard; a mark Tab picked out is found where the screen drew its reply (SceneModel.talkEnd), where the prototype took the reply to end at the frame's foot, so over a conversation shorter than the frame it opened rows off its phrase, or over it.
import type { MouseEvent } from "@opentui/core";
import { replyRows } from "../reply.ts";
import type { SceneModel } from "../scene/model.ts";
import { C, MARK_LABEL } from "../theme.ts";
import { BOLD, Keys, wrap, type KeyHint } from "./common.tsx";
import { sceneSide } from "./scene.tsx";

/**
 * A marked phrase, opened (a click on it, or Enter on what Tab picked out): the phrase in its kind's
 * colour, the note on it (written from what the player knows), and, where the mark is about
 * something the player knows (someone, a place or custom anyone could read about, something they
 * did), its card: what they knew of it when the note was written, never what's behind the GM's
 * screen. It opens by the phrase, below it or above it, inside the conversation's frame and clear
 * of the phrase itself (what it has no room for goes, the card first), and closes with Esc or a
 * click outside it; Tab goes on to the reply's next mark.
 */
export function MarkPopover({ scene, at, width, height }: { scene: SceneModel; at: { line: number; mark: number; x?: number | undefined; y?: number | undefined }; width: number; height: number }) {
  const lines = scene.lines();
  const line = lines[at.line];
  const mark = line?.marked?.marks[at.mark];
  if (!line?.marked || !mark) return null;
  const close = () => scene.closeOverlay();
  const count = line.marked.marks.length;
  // The conversation's frame (the scene screen says how big it's drawn): the popover stays inside it.
  const side = sceneSide(width);
  const area = scene.talkArea ?? { w: Math.max(30, width - side), h: Math.max(8, height - 5) };
  const room = { top: 1, bottom: area.h - 2, left: 1, right: area.w - 2 };
  const w = Math.max(20, Math.min(60, room.right - room.left + 1));
  const inner = w - 4;
  const phrase = wrap(`“${line.text.slice(mark.start, mark.end).replace(/^[“"]|[”"]$/g, "")}”`, inner).map(text => ({ text, fg: C[mark.kind], bold: true }));
  const note = wrap(mark.note, inner).map(text => ({ text, fg: C.text }));
  const card = mark.card;
  const told = card?.lines.length ? [...wrap(card.title, inner).map(text => ({ text, fg: C.title, bold: true })), ...card.lines.flatMap(l => wrap(l, inner).map(text => ({ text, fg: C.dim })))] : [];
  // Where the phrase is drawn: where it was clicked; else (Tab picked it out of the last reply, at
  // the conversation's end) worked out from the reply's rows, the last of them where it was drawn.
  const y = at.y ?? drawnAt(scene, at, width - side - 9, lastRow(scene, room), room);
  const below = y === undefined ? 0 : room.bottom - y;
  const above = y === undefined ? room.bottom - room.top + 1 : y - room.top;
  // Its rows, as many as there's room for on the roomier side: the card goes first, then the note's end.
  const space = Math.max(below, above) - 3;
  const blank = { text: "", fg: C.text };
  let rows: Array<{ text: string; fg: string; bold?: boolean }> = [...phrase, blank, ...note, ...(told.length ? [blank, ...told] : [])];
  if (rows.length > space) rows = [...phrase, blank, ...note];
  if (rows.length > space) rows = [...rows.slice(0, Math.max(phrase.length + 2, space - 1)), { text: "…", fg: C.dim }];
  const h = rows.length + 3;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const left = clamp(at.x !== undefined ? at.x - 2 : Math.floor((area.w - w) / 2), room.left, Math.max(room.left, room.right - w + 1));
  const top = y === undefined ? room.top
    : h <= below ? y + 1
    : h <= above ? y - h
    : below >= above ? clamp(y + 1, room.top, room.bottom - h + 1) : clamp(y - h, room.top, room.bottom - h + 1);
  const keys: KeyHint[] = [["Esc", "close", close], ...(count > 1 ? [["Tab", "the next", () => scene.stepMark(1)] as KeyHint] : [])];
  return <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0 || e.button === 2) close(); }} />
    <box position="absolute" left={left} top={top} width={w} height={h} zIndex={100} border borderStyle="rounded" borderColor={C[mark.kind]}
      backgroundColor={C.panel} title={` ${MARK_LABEL[mark.kind]} `} titleAlignment="left" titleColor={C[mark.kind]} paddingX={1} flexDirection="column"
      onMouseDown={(e: MouseEvent) => e.stopPropagation()}>
      {rows.map((r, i) => <text key={i} height={1} flexShrink={0} fg={r.fg} {...("bold" in r && r.bold ? { attributes: BOLD } : {})}>{r.text || " "}</text>)}
      <Keys items={keys} gap=" · " />
    </box>
  </>;
}

/**
 * The row a mark of the conversation's last reply is drawn on: the reply's last row is `lastRow`,
 * and its rows wrap at `columns`. Undefined for a mark of an earlier line, or one out of the frame.
 */
function drawnAt(scene: SceneModel, at: { line: number; mark: number }, columns: number, lastRow: number, room: { top: number; bottom: number }): number | undefined {
  const lines = scene.lines();
  const line = lines[at.line];
  if (!line?.marked || at.line !== lines.length - 1) return undefined;
  const rows = replyRows(line.text, line.marked, Math.max(1, columns), { narration: "", speech: () => "", mark: () => "" });
  const row = rows.findIndex(r => r.some(run => run.mark === at.mark));
  if (row < 0) return undefined;
  const y = lastRow - (rows.length - 1 - row);
  return y >= room.top && y <= room.bottom ? y : undefined;
}

/**
 * The row the conversation's last reply ends on: just above the last turn's lower edge, which is the
 * conversation's last row, wherever the screen drew it (SceneModel.talkEnd). Until it's drawn, the
 * frame's foot, where a conversation that fills the frame sticks (the prototype's only case).
 */
function lastRow(scene: SceneModel, room: { bottom: number }): number {
  return (scene.talkEnd?.() ?? room.bottom) - 1;
}
