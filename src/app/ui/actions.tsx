import { MouseButton, type KeyEvent, type MouseEvent } from "@opentui/core";
import { C } from "../theme.ts";
import { BOLD, fit, ITALIC, Keys, type KeyHint } from "./common.tsx";

/**
 * The action menu: what the player can do, grouped by kind (cantrips, spells by level with their
 * slots, class features with their uses, actions, what's to hand), one line each. What can't be
 * done now is dimmed, with why. Click one, or ↑↓ and Enter, or its number (1–9 count down the rows
 * on show); ←→ jump a kind; the wheel scrolls; Esc, or a click outside it, puts it away. The map's
 * (m) and the fight's (m) are the same menu.
 */

export interface MenuLine {
  name: string;
  summary: string;
  /** Why it can't be done now, when it can't. */
  why?: string;
  /** It's aimed on the map next (a ▸ after it). */
  aims?: boolean;
}

export interface MenuGroup { title: string; note?: string; lines: MenuLine[] }

interface Row { kind: "head"; title: string; note?: string; group: number }
interface Line { kind: "line"; line: MenuLine; index: number; group: number }

/** The menu's rows, top to bottom: each kind's heading, then its lines. */
function rowsOf(groups: MenuGroup[]): Array<Row | Line> {
  const rows: Array<Row | Line> = [];
  let index = 0;
  groups.forEach((g, group) => {
    rows.push({ kind: "head", title: g.title, ...(g.note ? { note: g.note } : {}), group });
    for (const line of g.lines) rows.push({ kind: "line", line, index: index++, group });
  });
  return rows;
}

/**
 * Where the list starts: where it was (`from`), moved only as far as it takes to bring the picked-out
 * line on show (with its heading, going up to the first line of a kind). A line picked by the pointer
 * is on show already, so the list never moves under the pointer.
 */
function windowOf(rows: Array<Row | Line>, index: number, room: number, from = 0): number {
  if (rows.length <= room) return 0;
  const at = rows.findIndex(r => r.kind === "line" && r.index === index);
  let start = Math.max(0, Math.min(from, rows.length - room));
  if (at >= 0 && at < start) start = rows[at - 1]?.kind === "head" ? at - 1 : at;
  else if (at >= start + room) start = at - room + 1;
  return Math.max(0, Math.min(start, rows.length - room));
}

export interface MenuLayout { left: number; top: number; w: number; h: number; room: number; start: number; rows: Array<Row | Line>; visible: number[] }

/**
 * How the menu sits on a screen: as wide as reads well, as tall as it needs, by the pointer when it
 * was asked for there. `from`: where the list started last time (it scrolls only to keep the picked line on show).
 */
export function menuLayout(groups: MenuGroup[], index: number, width: number, height: number, anchor?: { x: number; y: number }, from = 0): MenuLayout {
  const rows = rowsOf(groups);
  const nameW = Math.min(28, Math.max(12, ...rows.map(r => (r.kind === "line" ? r.line.name.length + (r.line.aims ? 2 : 0) : 0))));
  const longest = Math.max(30, ...rows.map(r => {
    if (r.kind === "head") return r.title.length + (r.note ? r.note.length + 3 : 0) + 2;
    const said = r.line.why ?? r.line.summary;
    return said ? 4 + nameW + 1 + said.length : 4 + r.line.name.length;
  }));
  const w = Math.max(30, Math.min(width - 2, longest + 4, 104));
  // The list, then a rule, two lines on the one picked out, and the keys.
  const h = Math.max(9, Math.min(height - (anchor ? 0 : 2), rows.length + 6));
  const room = h - 6;
  const start = windowOf(rows, index, room, from);
  const visible = rows.slice(start, start + room).filter((r): r is Line => r.kind === "line").map(r => r.index);
  // Centred over the map, or by the pointer (a right-click's "Do something…"), flipped where there's no room.
  const left = anchor ? Math.max(0, anchor.x + 2 + w <= width ? anchor.x + 2 : anchor.x - 1 - w) : Math.max(0, Math.floor((width - w) / 2));
  const top = anchor ? Math.max(0, Math.min(height - h, anchor.y + 1 + h <= height ? anchor.y + 1 : anchor.y - h)) : Math.max(0, Math.floor((height - h) / 2) - 1);
  return { left, top, w, h, room, start, rows, visible };
}

/** What a key does in the menu: pick another line, choose one, or put the menu away. */
export function menuKey(key: KeyEvent, groups: MenuGroup[], index: number, layout: MenuLayout): { index?: number; choose?: number; close?: boolean } {
  const count = groups.reduce((n, g) => n + g.lines.length, 0);
  if (!count) return { close: true };
  const firsts = groups.map((g, i) => groups.slice(0, i).reduce((n, x) => n + x.lines.length, 0)).filter((_, i) => groups[i]!.lines.length);
  const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
  const name = key.name;
  if (name === "up" || name === "w" || name === "k") return { index: (index + count - 1) % count };
  if (name === "down" || name === "s" || name === "j") return { index: (index + 1) % count };
  if (name === "pageup") return { index: Math.max(0, index - Math.max(1, layout.room - 2)) };
  if (name === "pagedown") return { index: Math.min(count - 1, index + Math.max(1, layout.room - 2)) };
  if (name === "home") return { index: 0 };
  if (name === "end") return { index: count - 1 };
  if (name === "right" || name === "d" || (name === "tab" && !key.shift)) { const next = firsts.find(f => f > index); return { index: next ?? firsts[0] ?? 0 }; }
  if (name === "left" || name === "a" || (name === "tab" && key.shift)) {
    const mine = firsts.filter(f => f <= index).at(-1) ?? 0;
    const prev = index > mine ? mine : firsts.filter(f => f < mine).at(-1) ?? firsts.at(-1) ?? 0;
    return { index: prev };
  }
  if (name === "return" || name === "enter" || name === "kpenter" || name === "space" || name === "e") return { choose: index };
  if (digit >= 0 && digit < layout.visible.length) return { choose: layout.visible[digit]! };
  if (name === "escape" || name === "q" || name === "m") return { close: true };
  return {};
}

/**
 * The menu on screen, over whatever's behind it. `index`: the picked-out line (a flat index over
 * every kind's lines, in order); `onPick` as the pointer moves over a line, `onChoose` on a click.
 */
export function ActionMenu({ title, groups, index, width, height, anchor, scroll: held, onPick, onChoose, onClose, keys }: {
  title: string; groups: MenuGroup[]; index: number; width: number; height: number; anchor?: { x: number; y: number } | undefined;
  /** Where the list starts, kept between draws (the menu's state): read, and written back as it scrolls. */
  scroll?: { top: number };
  onPick: (i: number) => void; onChoose: (i: number) => void; onClose: () => void; keys?: KeyHint[];
}) {
  const layout = menuLayout(groups, index, width, height, anchor, held?.top ?? 0);
  if (held) held.top = layout.start;
  const { left, top, w, h, room, start, rows, visible } = layout;
  const inner = w - 4;
  const nameW = Math.min(28, Math.max(12, ...rows.map(r => (r.kind === "line" ? r.line.name.length + (r.line.aims ? 2 : 0) : 0))));
  const lines = rows.slice(start, start + room);
  const count = groups.reduce((n, g) => n + g.lines.length, 0);
  const picked = rows.find((r): r is Line => r.kind === "line" && r.index === index)?.line;
  const detail = picked ? `${picked.name}${picked.summary ? `: ${picked.summary}` : ""}${picked.why ? `. Not now: ${picked.why}.` : ""}` : "";
  const more = { above: start > 0, below: start + room < rows.length };
  const hints: KeyHint[] = keys ?? [["↑↓", "choose"], ["Enter", "do it"], ["1–9", ""], ["←→", "kinds"], ["Esc", "never mind", onClose]];
  const scroll = (e: MouseEvent) => {
    const d = e.scroll?.direction;
    if (d === "up") onPick(Math.max(0, index - 1));
    else if (d === "down") onPick(Math.min(count - 1, index + 1));
  };
  return <>
    {/* A click anywhere outside it puts it away. */}
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={60} onMouseDown={(e: MouseEvent) => { if (e.button === MouseButton.LEFT || e.button === MouseButton.RIGHT) onClose(); }} />
    <box position="absolute" left={left} top={top} width={w} height={h} zIndex={61} border borderStyle="rounded" borderColor={C.borderHot} backgroundColor={C.panel}
      title={` ${truncate(title, w - 4)} `} titleAlignment="left" flexDirection="column" paddingX={1} onMouseScroll={scroll}
      onMouseDown={(e: MouseEvent) => e.stopPropagation()}>
      <box height={room} flexDirection="column" flexShrink={0} overflow="hidden">
        {lines.map((r, k) => {
          if (r.kind === "head") {
            const edge = k === 0 && more.above ? " ↑" : "";
            return <text key={`h${r.group}`} height={1} flexShrink={0}>
              <span fg={C.title} attributes={BOLD}>{truncate(r.title, inner)}</span>
              {r.note ? <span fg={C.dim}>{truncate(`  ${r.note}`, Math.max(0, inner - r.title.length - edge.length))}</span> : null}
              {edge ? <span fg={C.faint}>{edge}</span> : null}
            </text>;
          }
          const n = visible.indexOf(r.index);
          const on = r.index === index;
          const off = !!r.line.why;
          const label = `${r.line.name}${r.line.aims ? " ▸" : ""}`;
          const said = off ? r.line.why! : r.line.summary;
          // A line with nothing more to say has the whole width for its name.
          const nameRoom = said ? nameW : inner - 2;
          return <box key={`l${r.index}`} height={1} flexShrink={0} {...(on ? { backgroundColor: C.highlightBg } : {})}
            onMouseOver={() => { if (!on) onPick(r.index); }}
            onMouseDown={(e: MouseEvent) => { e.stopPropagation(); if (e.button === MouseButton.LEFT) onChoose(r.index); }}>
            <text>
              <span fg={on ? C.lead : C.faint}>{`${n >= 0 && n < 9 ? n + 1 : " "} `}</span>
              <span fg={off ? C.faint : on ? C.title : C.text} {...(on && !off ? { attributes: BOLD } : {})}>{said ? truncate(label, nameRoom).padEnd(nameRoom) : truncate(label, nameRoom)}</span>
              {said ? <span fg={off ? C.faint : C.dim} {...(off ? { attributes: ITALIC } : {})}>{truncate(` ${said}`, Math.max(0, inner - 2 - nameW))}</span> : null}
            </text>
          </box>;
        })}
      </box>
      <text height={1} flexShrink={0} fg={more.below ? C.faint : C.border}>{more.below ? truncate("  ↓ more", inner) : "─".repeat(Math.max(0, inner))}</text>
      <text height={2} flexShrink={0} fg={picked?.why ? C.warn : C.text} wrapMode="word">{truncate(detail, inner * 2)}</text>
      <Keys items={fit(hints, inner, 3)} gap=" · " />
    </box>
  </>;
}

/**
 * A fight's options (its action ids, as the QA console has them) by kind, for the same menu:
 * attacks, cantrips and spells by level (with the slots left), what's there to knock over, moving,
 * and the turn's other actions. `ids[i]` is the action the i-th line does.
 */
export function fightGroups(actions: Array<{ id: string; label: string }>, spells: Array<{ id: string; level: number }>, slots: string): { groups: MenuGroup[]; ids: string[] } {
  const ORD = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
  const left = Object.fromEntries(slots.split(", ").filter(Boolean).map(s => { const [o, n] = s.split(" "); return [o!, n!]; }));
  const buckets = new Map<string, { title: string; note?: string; order: number; items: Array<{ id: string; line: MenuLine }> }>();
  const put = (key: string, title: string, order: number, id: string, line: MenuLine, note?: string) => {
    const b = buckets.get(key) ?? { title, order, items: [], ...(note ? { note } : {}) };
    b.items.push({ id, line });
    buckets.set(key, b);
  };
  for (const a of actions) {
    const cast = /^cast_(.+?)(?:_at_.+|_.+)?$/.exec(a.id);
    const spell = cast ? spells.find(s => a.id === `cast_${s.id}` || a.id.startsWith(`cast_${s.id}_`)) : undefined;
    // "Cast Fireball at Hep (3rd slot) (fire: mind the dust)": what it is, then what's in brackets.
    const name = a.label.split(" (")[0] ?? a.label;
    const detail = a.label.slice(name.length).trim().replace(/\)\s*\(/g, ", ").replace(/^\(|\)$/g, "");
    const rest: string[] = [];
    if (/^attack_/.test(a.id)) put("attacks", "Attacks", 0, a.id, { name: name ?? a.label, summary: detail });
    else if (spell && spell.level === 0) put("cantrips", "Cantrips", 1, a.id, { name: (name ?? a.label).replace(/^Cast /, ""), summary: detail });
    else if (spell) put(`spells-${spell.level}`, `${ORD[spell.level]} level`, 1 + spell.level, a.id, { name: (name ?? a.label).replace(/^Cast /, ""), summary: detail }, left[ORD[spell.level]!] ? `${left[ORD[spell.level]!]} slots` : undefined);
    else if (/^use_/.test(a.id)) put("things", "Things to hand", 20, a.id, { name: name ?? a.label, summary: detail });
    else if (/^(close_|step_|move_|make_for|leave$)/.test(a.id)) put("moving", "Moving", 30, a.id, { name: name ?? a.label, summary: detail });
    else put("actions", "Actions", 40, a.id, { name: name ?? a.label, summary: detail || rest.join(" ") });
  }
  const sorted = [...buckets.values()].sort((a, b) => a.order - b.order);
  return {
    groups: sorted.map(b => ({ title: b.title, ...(b.note ? { note: b.note } : {}), lines: b.items.map(i => i.line) })),
    ids: sorted.flatMap(b => b.items.map(i => i.id)),
  };
}

const truncate = (t: string, n: number) => (n <= 0 ? "" : t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
