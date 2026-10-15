import type { WorldSpec } from "../../world/scene-world.ts";
import type { Dressing } from "../look/stage.ts";
import type { Ground, WallStyle } from "../look/terrain.ts";
import { isRoofed, isStructure, type MapTile } from "../map/tiles.ts";
import type { Region, TileMap } from "../types.ts";

/**
 * A dressing for the look layer's stage (the view from above) read off a map, for worlds that line
 * up with one (the zoo's wings and rooms): the ground under each area, the walls as runs of built
 * squares, which areas are roofed. A hand-made scene world has its dressing written by hand
 * (look/dressings.ts); a compiled place gets one from its compiler (generate/dressing.ts).
 */

const GROUND: Record<string, Ground> = { cobbles: "cobbles", floor: "flags", flags: "flags", boards: "boards", grass: "grass", dirt: "dirt", water: "water", "deep-water": "deep-water", stairs: "steps", bridge: "boards", carpet: "carpet", rubble: "rubble", scorched: "scorched" };
const WALL: Record<string, WallStyle> = { civic: "stone", stone: "stone", brick: "brick", timber: "timber", tar: "timber", plaster: "plaster", bank: "bank", palace: "palace", gilt: "palace", panel: "timber", hull: "timber", fence: "timber", hedge: "hedge", granary: "brick" };

const groundOf = (t: MapTile | undefined): Ground => (t ? GROUND[t.terrain === "floor" && t.style ? t.style : t.terrain] ?? GROUND[t.terrain] ?? "cobbles" : "cobbles");

export function dressingFromMap(map: TileMap, region: Region, spec: Pick<WorldSpec, "size" | "areas">, extra: Partial<Dressing> = {}): Dressing {
  const o = region.worldOrigin ?? { x: region.rect.x, y: region.rect.y };
  const tile = (x: number, y: number) => map.tiles[y]?.[x] as MapTile | undefined;
  const w = Math.ceil(spec.size.w / 5), h = Math.ceil(spec.size.h / 5);
  const feet = (x: number, y: number): [number, number] => [(x - o.x) * 5 + 2.5, (y - o.y) * 5 + 2.5];
  const built = (x: number, y: number) => { const t = tile(x, y); return !!t && isStructure(t) && x >= o.x && y >= o.y && x < o.x + w && y < o.y + h; };
  const styleOf = (x: number, y: number) => WALL[tile(x, y)?.style ?? ""] ?? "stone";
  const walls: NonNullable<Dressing["walls"]> = [];
  for (let y = o.y; y < o.y + h; y++) for (let x = o.x; x < o.x + w; x++) {
    if (!built(x, y)) continue;
    const style = styleOf(x, y);
    if (!built(x - 1, y) || styleOf(x - 1, y) !== style) {
      let end = x;
      while (built(end + 1, y) && styleOf(end + 1, y) === style) end++;
      if (end > x) walls.push({ from: feet(x, y), to: feet(end, y), style });
    }
    if (!built(x, y - 1) || styleOf(x, y - 1) !== style) {
      let end = y;
      while (built(x, end + 1) && styleOf(x, end + 1) === style) end++;
      if (end > y || (!built(x - 1, y) && !built(x + 1, y))) walls.push({ from: feet(x, y), to: feet(x, end), style });
    }
  }
  const ground: Record<string, Ground> = {};
  const indoor: string[] = [];
  for (const a of spec.areas) {
    const cx = o.x + Math.floor((a.rect.x + a.rect.w / 2) / 5), cy = o.y + Math.floor((a.rect.y + a.rect.h / 2) / 5);
    ground[a.id] = groundOf(tile(cx, cy));
    if (tile(cx, cy) && isRoofed(tile(cx, cy)!)) indoor.push(a.id);
  }
  // Odd squares of other ground inside the areas (a ditch's water, a strip of boards) as patches.
  const patches: NonNullable<Dressing["patches"]> = [];
  for (let y = o.y; y < o.y + h; y++) for (let x = o.x; x < o.x + w; x++) {
    const t = tile(x, y);
    if (!t || isStructure(t)) continue;
    // The smallest area round the square is the one whose ground it's drawn on.
    const [fx, fy] = feet(x, y);
    const here = spec.areas.filter(a => fx >= a.rect.x && fy >= a.rect.y && fx < a.rect.x + a.rect.w && fy < a.rect.y + a.rect.h).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    if (!here || ground[here.id] === groundOf(t)) continue;
    patches.push({ ground: groundOf(t), rect: { x: (x - o.x) * 5, y: (y - o.y) * 5, w: 5, h: 5 }, ragged: 0 });
  }
  return { ground, walls, indoor, ...(patches.length ? { patches } : {}), ...extra };
}
