import type { MapTile } from "../tiles.ts";
import type { CompiledPlace } from "./compile.ts";

/**
 * A compiled place as a plain top-down grid, the way the hand-made maps are written (north at the
 * top): for tests, logs and the README. Walls #, doors +, windows o, low walls (counters, rails) =,
 * floors . (indoor) and , (outdoor), water ~ (deep ≈), planks -, steps v; things by the first letter
 * of their id (people in capitals), the player @.
 */
export function sketch(place: CompiledPlace): string {
  const { map, furnished } = place;
  const rows: string[][] = (map.tiles as MapTile[][]).map(row => row.map((t): string => {
    switch (t.terrain) {
      case "wall": return t.style === "bank" ? "K" : "#";
      case "door": return "+";
      case "window": return "o";
      case "fence": return "=";
      case "water": return "~";
      case "deep-water": return "≈";
      case "bridge": return "-";
      case "stairs": return "v";
      case "void": return " ";
      default: return t.roof ? "." : ",";
    }
  }));
  const put = (x: number, y: number, ch: string) => { if (rows[y]?.[x] !== undefined) rows[y]![x] = ch; };
  for (const p of furnished.things.values()) if (!p.run && !p.terrain && !p.heldBy) for (const t of p.tiles) put(t.x, t.y, p.aloft ? "^" : p.id[0]!);
  for (const p of furnished.people.values()) if (p.anchor) put(p.anchor.x, p.anchor.y, p.id[0]!.toUpperCase());
  put(furnished.start.x, furnished.start.y, "@");
  return rows.map(r => r.join("")).join("\n");
}
