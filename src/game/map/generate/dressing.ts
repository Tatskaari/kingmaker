import { buildWorld } from "../../../world/scene-world.ts";
import type { StoryState, StyledLine, Tile2 } from "../../types.ts";
import { renderStage, type Dressing } from "../../look/index.ts";
import type { Ground, WallStyle } from "../../look/terrain.ts";
import type { MapTile } from "../tiles.ts";
import type { CompiledPlace } from "./compile.ts";
import { FEET } from "./compile.ts";

/**
 * A generated place's dressing for the look layer's top-down stage (src/game/look/stage.ts): what
 * its floors are, where its walls and windows run, which areas are indoors, where the water is.
 * The hand-made worlds have theirs written by hand (look/dressings.ts); a compiled place knows all
 * of it already, so it comes for free.
 */

const FLOOR: Record<string, Ground> = { boards: "boards", flagstones: "flags", earth: "dirt", carpet: "carpet", tiles: "flags" };
const OUTSIDE: Record<string, Ground> = { cobbles: "cobbles", boards: "boards", "planks-over-water": "boards", dirt: "dirt", grass: "grass", steps: "steps", water: "river", boat: "boards" };
const WALL: Record<string, WallStyle> = { civic: "stone", stone: "stone", brick: "brick", timber: "timber", tar: "timber", plaster: "plaster", bank: "bank", palace: "palace", gilt: "palace", panel: "timber", hull: "timber", fence: "timber" };

export function dressingOf(place: CompiledPlace): Dressing {
  const { map, site } = place;
  const ground: Record<string, Ground> = {};
  for (const a of site.areas.values()) ground[a.id] = a.room ? FLOOR[a.ground] ?? "boards" : OUTSIDE[a.ground] ?? "cobbles";
  const at = (p: Tile2): [number, number] => [p.x * FEET + FEET / 2, p.y * FEET + FEET / 2];
  const tileAt = (x: number, y: number) => map.tiles[y]?.[x] as MapTile | undefined;
  const walled = (t: MapTile | undefined) => !!t && (t.terrain === "wall" || t.terrain === "window" || t.terrain === "door" || t.terrain === "fence");
  const styleOf = (t: MapTile) => WALL[t.style ?? site.style] ?? "stone";

  // Walls: every run of built squares, along rows and down columns, as a line through their middles.
  const walls: NonNullable<Dressing["walls"]> = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = tileAt(x, y)!;
    if (!walled(t)) continue;
    const style = styleOf(t);
    if (!walled(tileAt(x - 1, y)) || styleOf(tileAt(x - 1, y)!) !== style) {
      let end = x;
      while (walled(tileAt(end + 1, y)) && styleOf(tileAt(end + 1, y)!) === style) end++;
      if (end > x) walls.push({ from: at({ x, y }), to: at({ x: end, y }), style });
    }
    if (!walled(tileAt(x, y - 1)) || styleOf(tileAt(x, y - 1)!) !== style) {
      let end = y;
      while (walled(tileAt(x, end + 1)) && styleOf(tileAt(x, end + 1)!) === style) end++;
      if (end > y || !walled(tileAt(x - 1, y)) && !walled(tileAt(x + 1, y))) walls.push({ from: at({ x, y }), to: at({ x, y: end }), style });
    }
  }
  // Ground the areas don't cover: the bank, the neighbours' yards, the deep water round it.
  const patches: NonNullable<Dressing["patches"]> = [];
  for (let y = 0; y < map.height; y++) {
    let start = -1;
    for (let x = 0; x <= map.width; x++) {
      const t = x < map.width ? tileAt(x, y)! : undefined;
      const bare = !!t && !walled(t) && !site.area[y * map.width + x] && ![...site.areas.values()].some(a => x >= a.rect.x && y >= a.rect.y && x < a.rect.x + a.rect.w && y < a.rect.y + a.rect.h);
      if (bare && start < 0) start = x;
      if (!bare && start >= 0) {
        const g: Ground = t0(tileAt(start, y)!);
        patches.push({ ground: g, rect: { x: start * FEET, y: y * FEET, w: (x - start) * FEET, h: FEET }, ragged: 0 });
        start = -1;
      }
    }
  }
  return {
    ground,
    patches,
    walls,
    indoor: [...site.areas.values()].filter(a => a.room).map(a => a.id),
    windows: site.windows.map(w => ({ at: at(w.at), radius: 8 })),
    // The river and the steps are the ground already.
    hide: place.world.things.filter(t => place.furnished.things.get(t.id)?.terrain).map(t => t.id),
  };
}

/** The ground a bare square shows as. */
function t0(t: MapTile): Ground {
  switch (t.terrain) {
    case "water": return "water";
    case "deep-water": return "deep-water";
    case "grass": return "grass";
    case "dirt": return "dirt";
    case "boards": case "bridge": return "boards";
    case "stairs": return "steps";
    default: return "cobbles";
  }
}

/** The place top-down, as the look layer's stage draws a scene world (people and all). */
export function stagePicture(place: CompiledPlace, time: StoryState["time"], size = { w: 96, h: 40 }, t = 1200): StyledLine[] {
  const world = buildWorld(place.region.sceneId ?? place.id, place.world, place.cast, { name: "you" });
  return renderStage(world, dressingOf(place), { w: size.w, h: size.h, t, time }).toLines();
}
