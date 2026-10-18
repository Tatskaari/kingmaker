// After the prototype's src/game/combat/render.ts at bc2ab1f: the fight top-down, a character a tile (people on things on fire on dust on the floor), its key, and who's who; plain text from the board and its map, for the headless client and a test. The v2 maps' trees and fences have characters of their own, a tile you can move to is marked, and everyone's hit points are shown (docs/combat-design.md §2).
import { key, solid } from "./grid.ts";
import type { FightBoard, Unit } from "./types.ts";
import type { TileMap, Tile2 } from "../map/types.ts";

/** A fight's board, top-down: one character a tile, with rulers (x across the top, y down the side). `marks`: tiles to mark (where the player can move). */
export function gridText(board: FightBoard, map: TileMap, marks: Tile2[] = []): string {
  const marked = new Set(marks.map(key));
  const tens = `   ${Array.from({ length: map.width }, (_, x) => (x % 10 === 0 ? String(Math.floor(x / 10)) : " ")).join("")}`;
  const ones = `   ${Array.from({ length: map.width }, (_, x) => String(x % 10)).join("")}`;
  const rows = Array.from({ length: map.height }, (_, y) => `${String(y).padStart(2)} ${Array.from({ length: map.width }, (_, x) => cell(board, map, { x, y }, marked)).join("")}`);
  return [tens, ones, ...rows].join("\n");
}

/** What each character on the grid is. */
export const KEY = "Key: @ you, a letter each for the others (the order says who's who, and whose side they're on), x down, ! gave up, # wall, + door or gate, | glass, = fence, ♣ tree, % stacked sacks, : grain dust, ^ fire, & brazier, o lantern, · where you can move";

/** What a unit is on the grid: their letter while they fight, x down, + dead, ! surrendered. */
export function glyphOf(u: Unit): string {
  return u.state === "fighting" ? u.glyph : u.state === "surrendered" ? "!" : u.state === "dead" ? "+" : u.state === "down" ? "x" : " ";
}

function cell(G: FightBoard, map: TileMap, t: Tile2, marked: Set<string>): string {
  const k = key(t);
  const unit = Object.values(G.units).filter(u => u.state !== "fled" && u.at.x === t.x && u.at.y === t.y).sort((a, b) => Number(b.state === "fighting") - Number(a.state === "fighting"))[0];
  if (unit) return glyphOf(unit);
  const prop = Object.values(G.props).find(p => !p.carriedBy && p.at.x === t.x && p.at.y === t.y && p.state === "standing");
  if (prop) return prop.kind === "brazier" ? "&" : "o";
  if (G.fire.includes(k)) return "^";
  if (marked.has(k)) return "·";
  const tile = map.tiles[t.y]?.[t.x];
  if (G.fuel.includes(k) && solid(map, t)) return "%";
  switch (tile?.terrain) {
    case "wall": return "#";
    case "door": return "+";
    case "window": return "|";
    case "fence": return "=";
    case "tree": return "♣";
    case "stairs": return "/";
    case "water": case "deep-water": return "~";
    case undefined: case "void": return " ";
    default: break;
  }
  if (tile?.blocks) return "#";
  if (G.dust.includes(k)) return ":";
  return ".";
}

/** Whose side someone's on, in a word for the order: the player's own line says "you". */
const SIDE: Record<Unit["side"], string> = { player: "", ally: "ally", enemy: "foe", neutral: "" };

/** Who's who, in initiative order: whose turn (▶), initiative, letter, name, whose side, hit points, how they are (asleep, prone, dodging...). */
export function orderLines(G: FightBoard, active: string): string[] {
  return G.order.filter(id => G.units[id]?.state !== "coming").map(id => {
    const u = G.units[id]!;
    const name = u.id === G.pc ? `you (${u.name})` : u.name;
    const how = u.state === "fighting" ? `${u.hp}/${u.maxHp} HP` : u.state === "surrendered" ? "gave up" : u.state === "fled" ? (G.flags[`walked:${u.id}`] ? "walked off" : "gone") : u.state === "dead" ? "dead" : `down (${u.hp}/${u.maxHp} HP)`;
    // Out cold is "down" once they're down; on their feet's count (a Sleep spell), asleep.
    const extra = [u.arrested ? "arrested" : "", ...u.conditions.filter(c => !/active$/.test(c) && !(c === "unconscious" && u.state !== "fighting")).map(c => (c === "dodged" ? "dodging" : c === "unconscious" ? "asleep" : c))].filter(Boolean);
    return `${id === active ? "▶" : " "} ${String(u.initiative).padStart(2)}  ${glyphOf(u)}  ${name.padEnd(30)} ${(u.id === G.pc ? "" : SIDE[u.side]).padEnd(4)} ${how}${extra.length ? ` (${extra.join(", ")})` : ""}`;
  });
}
