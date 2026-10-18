// After the prototype's src/app/ui/overlay.tsx at 44c6d4a, its report box (:263-281: what went wrong, the line typed, a word when nothing was, the note that it never keeps the key; saving; then where it went, with Enter back to the game), over whatever screen is up where it was the Game's overlay; the line is the report's own (client/report/model.ts), and the keys come to it before any screen's (useKeysFirst).
import type { MouseEvent } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import type { ReportModel } from "../report/model.ts";
import { C } from "../theme.ts";
import { Keys, Spinner, useKeysFirst, usePasteFirst, useStore, wrap, type KeyHint } from "./common.tsx";

/** What the question asks, and what it promises. */
export const ASK = "What went wrong? A line or two: what you did, what happened, what you expected.";
export const NOTE = "The report keeps this game, what's on screen and the GM's calls (never your key), for Claude to look into.";
const PLACEHOLDER = "Kell asked me the same thing three times…";
/** The most rows the line takes before it scrolls. */
const LINE_ROWS = 3;

/**
 * Reporting a problem, over whatever screen is up (V16, M5): the question with the line being
 * typed (Enter sends it, Esc never minds), then a spinner while it's saved, then where it went, to
 * tell Claude (Enter, or a click, back to the game). While it's up every key is its own, and a click
 * outside it does nothing: what's being typed isn't lost to a stray click. Ctrl+C still leaves.
 */
export function ReportOverlay({ report }: { report: ReportModel }) {
  useStore(report);
  const { width, height } = useTerminalDimensions();
  useKeysFirst(key => {
    if (!report.open || (key.ctrl && (key.name === "c" || key.name === "d"))) return false;
    report.key(key);
    return true;
  });
  usePasteFirst(text => {
    if (!report.open) return false;
    report.paste(text);
    return true;
  });
  const s = report.state;
  if (!s) return null;
  const w = Math.min(width - 4, 90);
  const inner = w - 4;
  const box = (title: string, rows: number, children: ReactNode, keys: KeyHint[], closes = false) => {
    const h = Math.min(height - 2, Math.max(5, rows));
    return <>
      <box position="absolute" left={0} top={0} width={width} height={height} zIndex={199} onMouseDown={(e: MouseEvent) => { if (e.button === 0 && closes) report.close(); }} />
      <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - h) / 2))} width={w} height={h} zIndex={200}
        border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
        <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
        <Keys items={keys} />
      </box>
    </>;
  };
  if (s.step === "sending") return box("Report a problem", 5, <Spinner label="Saving the report…" />, []);
  if (s.step === "said") {
    const said = wrap(s.said, inner);
    return box(s.failed ? "The report couldn't be saved" : "Report saved", said.length + 4,
      <text fg={s.failed ? C.danger : C.text}>{said.join("\n")}</text>, [["Enter", "back to the game", () => report.close()]], true);
  }
  const ask = wrap(ASK, inner), note = wrap(NOTE, inner), problem = s.problem ? wrap(s.problem, inner) : [];
  const rows = Math.min(LINE_ROWS, Math.max(1, Math.ceil((s.text.length + 1) / (inner - 2))));
  return box("Report a problem", ask.length + rows + 2 + problem.length + note.length + 3, <box flexDirection="column">
    <text fg={C.title} flexShrink={0}>{ask.join("\n")}</text>
    <box height={rows + 2} border borderColor={C.borderHot} paddingX={0} flexShrink={0} flexDirection="column">
      <Line text={s.text} cursor={s.cursor} width={inner - 2} rows={rows} />
    </box>
    {problem.length ? <text fg={C.warn} flexShrink={0}>{problem.join("\n")}</text> : null}
    <text fg={C.dim} flexShrink={0}>{note.join("\n")}</text>
  </box>, [["Enter", "send", () => void report.send()], ["Esc", "never mind", () => report.close()]]);
}

/** The line typed, a row at a time, the cursor lit where it is; the rows around the cursor when it's longer than they hold; the placeholder while it's empty. */
function Line({ text, cursor, width, rows }: { text: string; cursor: number; width: number; rows: number }) {
  if (!text) return <text height={1}><span fg={C.bg} bg={C.title}>{" "}</span><span fg={C.faint}>{PLACEHOLDER.slice(0, Math.max(0, width - 1))}</span></text>;
  const all = chunks(`${text} `, width);
  const at = Math.min(all.length - 1, Math.floor(cursor / width));
  const first = Math.max(0, Math.min(at - rows + 1, all.length - rows));
  return <>{all.slice(first, first + rows).map((row, i) => {
    const n = first + i;
    const c = n === at ? cursor - n * width : -1;
    return <text key={n} height={1}>{c < 0 ? <span fg={C.player}>{row}</span> : <>
      <span fg={C.player}>{row.slice(0, c)}</span><span fg={C.bg} bg={C.title}>{row[c] ?? " "}</span><span fg={C.player}>{row.slice(c + 1)}</span>
    </>}</text>;
  })}</>;
}

/** Text in rows `width` long (the last may be shorter). */
const chunks = (text: string, width: number) => Array.from({ length: Math.max(1, Math.ceil(text.length / width)) }, (_, i) => text.slice(i * width, (i + 1) * width));
