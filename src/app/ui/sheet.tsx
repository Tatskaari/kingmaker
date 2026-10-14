import type { MouseEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import type { SheetData } from "../../rules/dnd.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC } from "./common.tsx";
import { sheetPages, type Row, type Run, type Who } from "./sheet-layout.ts";

/**
 * The character sheet on screen: sheetPages (sheet-layout.ts) for the box it's given, with its
 * pages, scrolling, keys and the mouse.
 */

const attributesOf = (r: Run) => (r.bold ? BOLD : 0) | (r.italic ? ITALIC : 0);

function SheetRow({ row }: { row: Row }) {
  if (!row.length) return <text height={1} flexShrink={0}> </text>;
  return <text height={1} flexShrink={0}>
    {row.map((r, j) => <span key={j} fg={r.fg ?? C.text} {...(r.bg ? { bg: r.bg } : {})} {...(attributesOf(r) ? { attributes: attributesOf(r) } : {})}>{r.text}</span>)}
  </text>;
}

/** A key and what it does; with a click, a button too. */
export type Hint = [key: string, what: string, click?: () => void];

/** Key hints in a row ("←→ pages · Esc close"), the clickable ones as buttons. */
function Hints({ items }: { items: Hint[] }) {
  return <box height={1} flexDirection="row" flexShrink={0}>
    {items.map(([key, what, click], i) => click
      ? <text key={i} height={1} flexShrink={0} onMouseDown={click} bg={C.highlightBg}>
        <span fg={C.title} attributes={BOLD}>{` ${key} `}</span><span fg={C.text}>{`${what} `}</span>
      </text>
      : <text key={i} height={1} flexShrink={0}><span fg={C.title}>{key}</span><span fg={C.dim}>{` ${what}`}</span></text>)
      .flatMap((el, i) => (i ? [<text key={`gap${i}`} height={1} flexShrink={0} fg={C.faint}>{"  ·  "}</text>, el] : [el]))}
  </box>;
}

/**
 * The sheet in a width by height box: a bar with the pages when it takes more than one (click one,
 * or ←→, Tab, 1-9) and a close button when there's onClose; the page, with a scroll bar when it's
 * longer than the box (the wheel, ↑↓, PgUp/PgDn, Home/End); and a row of key hints, the sheet's
 * own and then the caller's (`keys`: the ones with a click are buttons). It takes keys only while
 * `active`.
 */
export function SheetView({ data, who, width, height, active, keys = [], onClose }: {
  data?: SheetData; who: Who; width: number; height: number; active: boolean; keys?: Hint[]; onClose?: () => void;
}) {
  const room = height - 1;
  const pages = useMemo(() => sheetPages(data, who, width, room, { bar: !!onClose }), [data, who.name, who.concept, width, room, !!onClose]);
  const [page, setPage] = useState(0);
  const [top, setTop] = useState(0);
  const at = Math.min(page, pages.length - 1);
  const p = pages[at]!;
  const tabs = pages.length > 1;
  const bar = tabs || !!onClose;
  const viewH = Math.max(1, room - (bar ? 1 : 0));
  const maxTop = Math.max(0, p.rows.length - viewH);
  const shown = Math.min(top, maxTop);
  const go = (i: number) => { setPage(((i % pages.length) + pages.length) % pages.length); setTop(0); };
  const scroll = (by: number) => setTop(Math.max(0, Math.min(maxTop, shown + by)));
  useKeyboard(key => {
    if (!active || key.defaultPrevented) return;
    if (tabs && (key.name === "right" || (key.name === "tab" && !key.shift))) go(at + 1);
    else if (tabs && (key.name === "left" || (key.name === "tab" && key.shift))) go(at - 1);
    else if (tabs && /^[1-9]$/.test(key.sequence ?? "") && Number(key.sequence) <= pages.length) go(Number(key.sequence) - 1);
    else if (maxTop && key.name === "down") scroll(1);
    else if (maxTop && key.name === "up") scroll(-1);
    else if (maxTop && key.name === "pagedown") scroll(viewH - 1);
    else if (maxTop && key.name === "pageup") scroll(-(viewH - 1));
    else if (maxTop && key.name === "home") scroll(-shown);
    else if (maxTop && key.name === "end") scroll(maxTop);
    else return;
    key.preventDefault();
  });
  const onWheel = (e: MouseEvent) => { if (e.scroll) scroll(e.scroll.direction === "up" ? -3 : e.scroll.direction === "down" ? 3 : 0); };
  // The scroll bar: a thumb the size of the view, along a faint track.
  const thumb = Math.max(1, Math.round((viewH * viewH) / Math.max(1, p.rows.length)));
  const thumbAt = maxTop ? Math.round(((viewH - thumb) * shown) / maxTop) : 0;
  const hints: Hint[] = [...keys, ...(tabs ? [["←→", "pages"] as Hint] : []), ...(maxTop ? [["↑↓", "scroll"] as Hint] : [])];
  return <box width={width} height={height} flexDirection="column" flexShrink={0}>
    {bar ? <box height={1} flexDirection="row" flexShrink={0}>
      {tabs ? pages.map((pg, i) => <text key={i} height={1} flexShrink={0} onMouseDown={() => go(i)} fg={i === at ? C.title : C.dim} {...(i === at ? { bg: C.highlightBg, attributes: BOLD } : {})}>{` ${i + 1} ${pg.title} `}</text>) : null}
      <box flexGrow={1} />
      {onClose ? <text height={1} flexShrink={0} fg={C.dim} onMouseDown={onClose}>{"[x]"}</text> : null}
    </box> : null}
    <box height={viewH} flexDirection="row" flexShrink={0} onMouseScroll={onWheel}>
      <box width={p.scrolls ? width - 2 : width} flexDirection="column">
        {p.rows.slice(shown, shown + viewH).map((row, i) => <SheetRow key={i} row={row} />)}
      </box>
      {p.scrolls ? <box width={2} flexDirection="column" paddingLeft={1}>
        {Array.from({ length: viewH }, (_, i) => <text key={i} height={1} fg={i >= thumbAt && i < thumbAt + thumb ? C.title : C.faint}>{i >= thumbAt && i < thumbAt + thumb ? "┃" : "│"}</text>)}
      </box> : null}
    </box>
    <Hints items={hints} />
  </box>;
}
