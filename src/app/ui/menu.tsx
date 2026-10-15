import { MouseButton, type MouseEvent } from "@opentui/core";
import { C } from "../theme.ts";
import { BOLD } from "./common.tsx";

/** A rectangle of the screen, in cells. */
export interface Bounds { x: number; y: number; w: number; h: number }

/**
 * A right-click menu, as the map's is (explore.tsx's MenuBox): what was clicked for its title, its
 * choices numbered (a click, ↑↓ and Enter, or the number), "Esc never mind" under them. It opens
 * below and to the right of the pointer, leaving what was clicked in sight, flipped where there's
 * no room, and kept within `bounds` (the panel it belongs to), so it never covers what the player
 * is reading. Choices that don't fit scroll with the highlight. Only a left click chooses: in a
 * small panel the menu covers what else might be right-clicked, so a right-click on it goes to
 * `onRight` (where it was), not to the choice that happens to be there.
 */
export function MenuBox({ title, items, index, x, y, bounds, onChoose, onHover, onRight }: {
  title: string; items: string[]; index: number; x: number; y: number; bounds: Bounds;
  onChoose: (i: number) => void; onHover: (i: number) => void;
  /** A right-click anywhere on the menu, where on screen (by default it just stays open). */
  onRight?: (x: number, y: number) => void;
}) {
  const w = Math.max(12, Math.min(bounds.w, Math.max(capital(title).length + 6, ...items.map(l => l.length + 8), 24)));
  const rows = Math.max(1, Math.min(items.length, bounds.h - 3));
  const h = rows + 3;
  const left = clamp(x + 2 + w <= bounds.x + bounds.w ? x + 2 : x - 1 - w, bounds.x, bounds.x + bounds.w - w);
  const top = clamp(y + 1 + h <= bounds.y + bounds.h ? y + 1 : y - h, bounds.y, bounds.y + bounds.h - h);
  const first = clamp(index - Math.floor(rows / 2), 0, items.length - rows);
  return <box position="absolute" left={left} top={top} width={w} height={h} zIndex={50} border borderStyle="rounded" borderColor={C.borderHot}
    backgroundColor={C.panel} title={` ${truncate(capital(title), w - 6)} `} titleAlignment="left" flexDirection="column" paddingX={1}
    onMouseDown={(e: MouseEvent) => { e.stopPropagation(); if (e.button === MouseButton.RIGHT) onRight?.(e.x, e.y); }}>
    {items.slice(first, first + rows).map((label, j) => {
      const i = first + j;
      const on = i === index;
      return <box key={i} height={1} flexShrink={0} {...(on ? { backgroundColor: C.highlightBg } : {})}
        onMouseDown={(e: MouseEvent) => { e.stopPropagation(); if (e.button === MouseButton.LEFT) onChoose(i); else if (e.button === MouseButton.RIGHT) onRight?.(e.x, e.y); }}
        onMouseOver={() => { if (index !== i) onHover(i); }}>
        <text>
          <span fg={on ? C.lead : C.faint}>{`${i < 9 ? i + 1 : " "} `}</span>
          <span fg={on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{truncate(label, w - 6)}</span>
        </text>
      </box>;
    })}
    <text fg={C.faint} height={1}>{truncate(items.length > rows ? `↑↓ more · Esc never mind` : "Esc never mind", w - 4)}</text>
  </box>;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
