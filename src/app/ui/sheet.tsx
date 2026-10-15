import type { KeyEvent, MouseEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useImperativeHandle, useMemo, useState, type Ref } from "react";
import type { SheetData } from "../../rules/dnd.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, isEnter, ITALIC } from "./common.tsx";
import { rowOf, sheetPages, spellOn, spellPage, spellsOn, type Row, type Run, type Who } from "./sheet-layout.ts";

/**
 * The character sheet on screen: sheetPages (sheet-layout.ts) for the box it's given, with its
 * pages, scrolling, keys and the mouse; and a spell on it, picked (a click, or ↑↓ and Enter), shown
 * in the same box until it's put back (spellPage).
 */

const attributesOf = (r: Run) => (r.bold ? BOLD : 0) | (r.italic ? ITALIC : 0);

/** A spell's page is no wider than this, however wide the box: lines of prose much longer are hard to read. */
const READ = 100;

const spans = (runs: Run[], bg?: string) => runs.map((r, j) => <span key={j} fg={r.fg ?? C.text} {...(r.bg || bg ? { bg: r.bg ?? bg } : {})} {...(attributesOf(r) ? { attributes: attributesOf(r) } : {})}>{r.text}</span>);

/**
 * A row as laid out; a spell on it is a button: it lights up under the mouse, and the one picked
 * with the keys has a colour of its own (its faint marks lifted to stay readable on it), so the
 * pointer over another doesn't hide which one Enter shows.
 */
function SheetRow({ row, picked, onSpell }: { row: Row; picked?: string | undefined; onSpell?: (id: string) => void }) {
  if (!row.length) return <text height={1} flexShrink={0}> </text>;
  if (!onSpell || !row.some(r => r.spell)) return <text height={1} flexShrink={0}>{spans(row)}</text>;
  const parts: Array<{ spell: string | undefined; runs: Run[] }> = [];
  for (const r of row) {
    const last = parts.at(-1);
    if (last && last.spell === r.spell) last.runs.push(r);
    else parts.push({ spell: r.spell, runs: [r] });
  }
  return <box height={1} flexDirection="row" flexShrink={0}>
    {parts.map((p, i) => p.spell
      ? <Clickable key={i} height={1} flexShrink={0} onClick={() => onSpell(p.spell!)} {...(p.spell === picked ? { backgroundColor: C.pickBg } : {})}>
        <text height={1} flexShrink={0}>{spans(p.spell === picked ? p.runs.map(r => (r.fg === C.faint ? { ...r, fg: C.dim } : r)) : p.runs)}</text>
      </Clickable>
      : <text key={i} height={1} flexShrink={0}>{spans(p.runs)}</text>)}
  </box>;
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

/** Rows in a box viewH high from row `top`, with a scroll bar when there are more of them. */
function Scrolled({ rows, top, viewH, width, scrolls, picked, onSpell, onWheel }: {
  rows: Row[]; top: number; viewH: number; width: number; scrolls: boolean; picked?: string | undefined; onSpell?: (id: string) => void; onWheel: (e: MouseEvent) => void;
}) {
  // The scroll bar: a thumb the size of the view, along a faint track.
  const maxTop = Math.max(0, rows.length - viewH);
  const thumb = Math.max(1, Math.round((viewH * viewH) / Math.max(1, rows.length)));
  const thumbAt = maxTop ? Math.round(((viewH - thumb) * top) / maxTop) : 0;
  return <box height={viewH} flexDirection="row" flexShrink={0} onMouseScroll={onWheel}>
    <box width={scrolls ? width - 2 : width} flexDirection="column">
      {rows.slice(top, top + viewH).map((row, i) => <SheetRow key={i} row={row} picked={picked} {...(onSpell ? { onSpell } : {})} />)}
    </box>
    {scrolls ? <box width={2} flexDirection="column" paddingLeft={1}>
      {Array.from({ length: viewH }, (_, i) => <text key={i} height={1} fg={i >= thumbAt && i < thumbAt + thumb ? C.title : C.faint}>{i >= thumbAt && i < thumbAt + thumb ? "┃" : "│"}</text>)}
    </box> : null}
  </box>;
}

/**
 * What a caller asks of the sheet before acting on a key of its own (Enter to set off, Esc to put
 * it away): whether the sheet has a use for it just now. With a spell open, every key is the
 * sheet's; with one picked, Enter, Space, Esc and the arrows are.
 */
export interface SheetHandle { wants(key: KeyEvent): boolean }

/**
 * The sheet in a width by height box: a bar with the pages when it takes more than one (click one,
 * or ←→, Tab, 1-9) and a close button when there's onClose; the page, with a scroll bar when it's
 * longer than the box (the wheel, ↑↓, PgUp/PgDn, Home/End); and a row of key hints, the sheet's
 * own and then the caller's (`keys`: the ones with a click are buttons). It takes keys only while
 * `active`.
 *
 * A spell on the page is a button: a click shows what it is, in the same box (the bar's ← Back, Esc,
 * Enter or Backspace put the sheet back as it was). On a page with spells ↑↓ pick one instead of
 * scrolling, and Enter (or Space) shows it, Esc lets it go. A caller with keys of its own asks
 * `ref`'s wants(key) first: the sheet may have a use for them.
 */
export function SheetView({ data, who, width, height, active, keys = [], onClose, ref }: {
  data?: SheetData | undefined; who: Who; width: number; height: number; active: boolean; keys?: Hint[]; onClose?: () => void; ref?: Ref<SheetHandle>;
}) {
  const room = height - 1;
  const pages = useMemo(() => sheetPages(data, who, width, room, { bar: !!onClose }), [data, who.name, who.concept, width, room, !!onClose]);
  const [page, setPage] = useState(0);
  const [top, setTop] = useState(0);
  const [picked, setPicked] = useState<string>();
  const [open, setOpen] = useState<string>();
  const [openTop, setOpenTop] = useState(0);
  const at = Math.min(page, pages.length - 1);
  const p = pages[at]!;
  const tabs = pages.length > 1;
  const bar = tabs || !!onClose;
  const viewH = Math.max(1, room - (bar ? 1 : 0));
  const maxTop = Math.max(0, p.rows.length - viewH);
  const shown = Math.min(top, maxTop);
  const spells = spellsOn(p.rows);
  const pick = picked && spells.includes(picked) ? picked : undefined;

  // A spell, open: the bar has the way back, and the page scrolls when it's long (laid out narrower
  // for its bar). Prose much wider than this is hard to read: a wide box keeps it to READ columns.
  const details = open ? spellOn(data, open) : undefined;
  const openH = Math.max(1, room - 1);
  const openRows = useMemo(() => {
    if (!details) return [];
    const rows = spellPage(details, Math.min(width, READ));
    return rows.length > openH ? spellPage(details, Math.min(width - 2, READ)) : rows;
  }, [details, width, openH]);
  const openScrolls = openRows.length > openH;
  const openMax = Math.max(0, openRows.length - openH);
  const openShown = Math.min(openTop, openMax);

  const go = (i: number) => { setPage(((i % pages.length) + pages.length) % pages.length); setTop(0); setPicked(undefined); };
  const scroll = (by: number) => setTop(Math.max(0, Math.min(maxTop, shown + by)));
  const scrollOpen = (by: number) => setOpenTop(Math.max(0, Math.min(openMax, openShown + by)));
  // Shown and put back, the sheet as it was: its page, where it was scrolled to, and the spell picked if there was one.
  const show = (id: string) => { setOpen(id); setOpenTop(0); };
  const back = () => setOpen(undefined);
  // The next spell along (or back), the page scrolled to keep it in sight.
  const step = (by: number) => {
    const i = pick ? spells.indexOf(pick) : by > 0 ? -1 : spells.length;
    const next = spells[((i + by) % spells.length + spells.length) % spells.length]!;
    setPicked(next);
    const y = rowOf(p.rows, next);
    if (y < shown) setTop(y);
    else if (y >= shown + viewH) setTop(y - viewH + 1);
  };

  /** What a key does here and now, if anything. */
  const action = (key: KeyEvent): (() => void) | undefined => {
    if (details) {
      if (key.name === "escape" || key.name === "backspace" || key.name === "left" || isEnter(key)) return back;
      if (openMax && (key.name === "down" || key.name === "space")) return () => scrollOpen(key.name === "space" ? openH - 1 : 1);
      if (openMax && key.name === "up") return () => scrollOpen(-1);
      if (openMax && key.name === "pagedown") return () => scrollOpen(openH - 1);
      if (openMax && key.name === "pageup") return () => scrollOpen(-(openH - 1));
      if (openMax && key.name === "home") return () => scrollOpen(-openShown);
      if (openMax && key.name === "end") return () => scrollOpen(openMax);
      return undefined;
    }
    if (pick && (isEnter(key) || key.name === "space")) return () => show(pick);
    if (pick && key.name === "escape") return () => setPicked(undefined);
    if (spells.length && key.name === "down") return () => step(1);
    if (spells.length && key.name === "up") return () => step(-1);
    if (tabs && (key.name === "right" || (key.name === "tab" && !key.shift))) return () => go(at + 1);
    if (tabs && (key.name === "left" || (key.name === "tab" && key.shift))) return () => go(at - 1);
    if (tabs && /^[1-9]$/.test(key.sequence ?? "") && Number(key.sequence) <= pages.length) return () => go(Number(key.sequence) - 1);
    if (maxTop && key.name === "down") return () => scroll(1);
    if (maxTop && key.name === "up") return () => scroll(-1);
    if (maxTop && key.name === "pagedown") return () => scroll(viewH - 1);
    if (maxTop && key.name === "pageup") return () => scroll(-(viewH - 1));
    if (maxTop && key.name === "home") return () => scroll(-shown);
    if (maxTop && key.name === "end") return () => scroll(maxTop);
    return undefined;
  };
  useImperativeHandle(ref, () => ({ wants: key => active && (!!details || !!action(key)) }));
  useKeyboard(key => {
    if (!active || key.defaultPrevented) return;
    const act = action(key);
    if (!act) {
      // A spell open takes every key: nothing behind it moves.
      if (details) key.preventDefault();
      return;
    }
    key.preventDefault();
    act();
  });
  const onWheel = (e: MouseEvent) => { if (e.scroll) scroll(e.scroll.direction === "up" ? -3 : e.scroll.direction === "down" ? 3 : 0); };
  const onWheelOpen = (e: MouseEvent) => { if (e.scroll) scrollOpen(e.scroll.direction === "up" ? -3 : e.scroll.direction === "down" ? 3 : 0); };
  const close = onClose ? <text height={1} flexShrink={0} fg={C.dim} onMouseDown={onClose}>{"[x]"}</text> : null;

  if (details) {
    const hints: Hint[] = [["Esc", "back to the sheet", back], ...(openMax ? [["↑↓", "scroll"] as Hint] : [])];
    return <box width={width} height={height} flexDirection="column" flexShrink={0}>
      <box height={1} flexDirection="row" flexShrink={0}>
        <text height={1} flexShrink={0} onMouseDown={back} bg={C.highlightBg}><span fg={C.title} attributes={BOLD}>{" ← Back "}</span></text>
        <text height={1} flexShrink={0} fg={C.dim}>{` ${details.name}`}</text>
        <box flexGrow={1} />
        {close}
      </box>
      <Scrolled rows={openRows} top={openShown} viewH={openH} width={width} scrolls={openScrolls} onWheel={onWheelOpen} />
      <Hints items={hints} />
    </box>;
  }

  const hints: Hint[] = [
    ...(pick ? [["Enter", "about it", () => show(pick)] as Hint, ["Esc", "let go", () => setPicked(undefined)] as Hint] : []),
    // A spell picked has Enter and Esc: the caller's wait.
    ...keys.filter(([k]) => !(pick && (k === "Enter" || k === "Esc"))),
    ...(tabs ? [["←→", "pages"] as Hint] : []),
    ...(spells.length ? [["↑↓", pick ? "spells" : "a spell"] as Hint] : maxTop ? [["↑↓", "scroll"] as Hint] : []),
  ];
  return <box width={width} height={height} flexDirection="column" flexShrink={0}>
    {bar ? <box height={1} flexDirection="row" flexShrink={0}>
      {tabs ? pages.map((pg, i) => <text key={i} height={1} flexShrink={0} onMouseDown={() => go(i)} fg={i === at ? C.title : C.dim} {...(i === at ? { bg: C.highlightBg, attributes: BOLD } : {})}>{` ${i + 1} ${pg.title} `}</text>) : null}
      <box flexGrow={1} />
      {close}
    </box> : null}
    <Scrolled rows={p.rows} top={shown} viewH={viewH} width={width} scrolls={!!p.scrolls} picked={pick} onSpell={show} onWheel={onWheel} />
    <Hints items={hints} />
  </box>;
}
