import type { Span, StyledLine, Tile2 } from "../types.ts";
import { key, solid, tileAt } from "./grid.ts";
import type { CombatG, Unit } from "./model.ts";
import { health } from "./rules.ts";

/**
 * A top-down tactical view of the fight: one character a tile, people on top of things on top of
 * fire on top of dust on top of the floor. Plain text for the demo and the QA API, styled spans for
 * the OpenTUI app (the map module's isometric view can draw the same actors instead).
 */

export interface GridOptions {
  /** Tiles to mark (where the player can move, a spell's area). */
  mark?: Tile2[];
  /** Number the rows and columns. */
  rulers?: boolean;
}

interface Cell { ch: string; fg: string; bg?: string; bold?: boolean }

function cell(G: CombatG, t: Tile2, marked: Set<string>): Cell {
  const k = key(t);
  const unit = Object.values(G.units).filter(u => u.state !== "fled" && u.at.x === t.x && u.at.y === t.y).sort((a, b) => Number(b.state === "fighting") - Number(a.state === "fighting"))[0];
  const active = G.units[G.order[G.active] ?? ""];
  const bg = marked.has(k) ? "#264653" : G.fire.includes(k) ? "#7f1d1d" : G.dust.includes(k) ? "#3a2f1a" : undefined;
  if (unit) {
    const ch = unit.state === "fighting" ? unit.glyph : unit.state === "surrendered" ? "!" : unit.state === "dead" ? "+" : "x";
    return { ch, fg: unit.state === "fighting" ? unit.color : "#999999", bold: unit.state === "fighting", bg: unit.id === active?.id && !G.outcome ? "#555500" : bg };
  }
  const prop = Object.values(G.props).find(p => !p.carriedBy && p.at.x === t.x && p.at.y === t.y && p.state === "standing");
  if (prop) return { ch: prop.kind === "brazier" ? "&" : "o", fg: prop.lit ? "#ffb000" : "#7f6000", bold: true, ...(bg ? { bg } : {}) };
  if (G.fire.includes(k)) return { ch: "^", fg: "#ff5722", bg: "#7f1d1d", bold: true };
  const tile = tileAt(G.map, t);
  const fuel = G.fuel.includes(k);
  if (fuel && solid(G.map, t)) return { ch: "%", fg: "#c9a227", ...(bg ? { bg } : {}) };
  switch (tile?.terrain) {
    case "wall": return { ch: "#", fg: "#6b5b4b" };
    case "door": return { ch: "+", fg: "#c08040", ...(bg ? { bg } : {}) };
    case "window": return { ch: "|", fg: "#9fc5e8" };
    case "stairs": return { ch: "/", fg: "#b0a090", ...(bg ? { bg } : {}) };
    case "water": case "deep-water": return { ch: "~", fg: "#3d85c6" };
    case undefined: return { ch: " ", fg: "#000000" };
    default: break;
  }
  if (fuel) return { ch: "\"", fg: "#c9a227", ...(bg ? { bg } : {}) };
  if (tile?.blocks) return { ch: "#", fg: "#6b5b4b" };
  if (G.dust.includes(k)) return { ch: ":", fg: "#bf9000", ...(bg ? { bg } : {}) };
  return { ch: (tile?.height ?? 0) > 0 ? "," : ".", fg: "#5f5f5f", ...(bg ? { bg } : {}) };
}

/** The grid as styled lines (OpenTUI spans). */
export function gridStyled(G: CombatG, options: GridOptions = {}): StyledLine[] {
  const marked = new Set((options.mark ?? []).map(key));
  const lines: StyledLine[] = [];
  if (options.rulers) {
    lines.push([{ text: `   ${Array.from({ length: G.map.width }, (_, x) => (x % 10 === 0 ? String(Math.floor(x / 10)) : " ")).join("")}`, fg: "#666666" }]);
    lines.push([{ text: `   ${Array.from({ length: G.map.width }, (_, x) => String(x % 10)).join("")}`, fg: "#666666" }]);
  }
  for (let y = 0; y < G.map.height; y++) {
    const spans: Span[] = options.rulers ? [{ text: `${String(y).padStart(2)} `, fg: "#666666" }] : [];
    for (let x = 0; x < G.map.width; x++) {
      const c = cell(G, { x, y }, marked);
      const last = spans.at(-1);
      // Runs of the same style share a span.
      if (last && last.fg === c.fg && last.bg === c.bg && !!last.bold === !!c.bold) last.text += c.ch;
      else spans.push({ text: c.ch, fg: c.fg, ...(c.bg ? { bg: c.bg } : {}), ...(c.bold ? { bold: true } : {}) });
    }
    lines.push(spans);
  }
  return lines;
}

/** The grid as plain text. */
export function gridText(G: CombatG, options: GridOptions = {}): string {
  return gridStyled(G, options).map(l => l.map(s => s.text).join("")).join("\n");
}

/** Who's who: glyph, name, how they are, and whose turn it is. */
export function legend(G: CombatG): string[] {
  const active = G.order[G.active];
  return G.order.map(id => {
    const u = G.units[id]!;
    const how = u.id === G.pc || u.side === "ally" ? `${u.hp}/${u.maxHp} HP${u.state !== "fighting" ? `, ${u.state}` : ""}` : health(u);
    const glyph = u.state === "fighting" ? u.glyph : u.state === "surrendered" ? "!" : u.state === "fled" ? " " : u.state === "dead" ? "+" : "x";
    const extra = [u.arrested ? "arrested" : "", ...u.conditions.filter(c => !/active$|unconscious/.test(c))].filter(Boolean);
    return `${id === active && !G.outcome ? ">" : " "} ${glyph} ${u.id === G.pc ? `${u.name} (you)` : u.name} [init ${u.initiative}]: ${how}${extra.length ? ` (${extra.join(", ")})` : ""}`;
  });
}

export const KEY = "Key: # wall  % stacked sacks  \" empty sacks  : grain dust  ^ fire  & brazier  o lantern  + door  | glass  / stair  x down  ! surrendered";

export const unitAt = (G: CombatG, t: Tile2): Unit | undefined => Object.values(G.units).find(u => u.state !== "fled" && u.at.x === t.x && u.at.y === t.y);
