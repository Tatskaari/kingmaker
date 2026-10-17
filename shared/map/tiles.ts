// Copied from the prototype's src/game/map/tiles.ts at 44c6d4a, whole; its types from ./types.ts. Added at the end: MapFile and LegendEntry (a map as campaign data: maps/<key>.json) and mapOf, which builds one with buildMap; and MapPerson, who's about on a map by the hour (presence.ts's town, as data).
import type { Interaction, MapActor, Region, StoryState, Terrain, Tile, Tile2, TileMap } from "./types.ts";

/**
 * Maps are authored as ASCII grids with a legend (one character per tile), so a person can read and
 * edit them. The legend gives each character a tile and, optionally, a piece of decor that stands on
 * it (a lamp post, a market stall, bunting); decor becomes ordinary map actors.
 *
 * Tiles and regions carry a little more than the shared contract (src/game/types.ts) asks for: a
 * style for the renderer (what a wall is made of), and for regions a description and how their scene
 * is triggered. Both are optional extensions, so the maps are plain TileMaps to everyone else.
 */

export interface MapTile extends Tile {
  /** The renderer's look: a palette key (stone, brick, timber, tar, palace, bank, granary, hedge...). */
  style?: string;
  /**
   * A floor under a roof (indoors): the roof's look from outside, and how high it is. The floor
   * itself stays at ground level (its `height` is 0): the roof is drawn only from outside.
   */
  roof?: string;
  roofHeight?: number;
}

export interface PlaceRegion extends Region {
  description?: string;
  /** How the scene here opens when it's the lead: by stepping in, or by talking to someone in it. */
  trigger?: "enter" | "interact";
  /** What the trigger says ("Step down into the Drowned Rat"). */
  label?: string;
  /** Shut outside its scene's time: what the player is told at the door. */
  shut?: string;
  /** The scene whose time opens it (default: its own sceneId): live, or already played. */
  opensFor?: string;
  /** Locked up once its scene has been played (you can still get out): what the player is told. */
  lockedAfter?: string;
  /** The outside of a scene's place on another map (the Heron seen from the town): it shows what the scene did to it. */
  exteriorOf?: string;
  /** What its locked doors say when they're tried (the town's own places have theirs in explore.ts). */
  locked?: string;
}

export interface DecorDef {
  name: string;
  glyph: string;
  color?: string;
  kind?: MapActor["kind"];
  blocks?: boolean;
  /** States worth drawing: "overhead" (bunting, eel traps: drawn high, never in the way), "lit", "light"... */
  states?: string[];
  /** Examine text. */
  text?: string;
  /** A stable id (unique features: the Corn Exchange price board); otherwise one is made from the tile. */
  id?: string;
}

export interface TileDef {
  tile: MapTile;
  decor?: DecorDef;
}

/** A map and the static things standing on it (decor from the legend). */
export interface MapDef {
  map: TileMap;
  decor: MapActor[];
}

/** What each terrain is like unless the legend says otherwise. */
const TERRAIN_DEFAULTS: Record<Terrain, Omit<MapTile, "terrain">> = {
  floor: {}, boards: {}, cobbles: {}, grass: {}, dirt: {}, stairs: {}, bridge: {},
  water: {},
  "deep-water": { blocks: true },
  wall: { blocks: true, opaque: true, height: 3 },
  door: { opaque: true, height: 3 },
  window: { blocks: true, height: 3 },
  fence: { blocks: true, height: 1 },
  tree: { blocks: true, opaque: true, height: 2 },
  void: { blocks: true },
};

/** A tile of a terrain, with the defaults filled in and any overrides on top. */
export function tile(terrain: Terrain, extra: Omit<MapTile, "terrain"> = {}): MapTile {
  return { terrain, ...TERRAIN_DEFAULTS[terrain], ...extra };
}

/** Shorthand for legend entries. */
export const T = (terrain: Terrain, extra: Omit<MapTile, "terrain"> = {}, decor?: DecorDef): TileDef => ({ tile: tile(terrain, extra), ...(decor ? { decor } : {}) });

export interface MapSpec {
  id: string;
  name: string;
  /** Rows of characters, north at the top; short rows are padded with void. */
  grid: string;
  legend: Record<string, TileDef>;
  regions: PlaceRegion[];
  exits?: TileMap["exits"];
}

/** Build a TileMap (and its decor) from an ASCII grid and its legend. Unknown characters are an error. */
export function buildMap(spec: MapSpec): MapDef {
  const rows = spec.grid.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const width = Math.max(...rows.map(r => [...r].length));
  const tiles: MapTile[][] = [];
  const decor: MapActor[] = [];
  rows.forEach((row, y) => {
    const chars = [...row.padEnd(width, " ")];
    tiles.push(chars.map((ch, x) => {
      const def = spec.legend[ch] ?? (ch === " " ? T("void") : undefined);
      if (!def) throw new Error(`${spec.id}: no legend entry for "${ch}" at (${x}, ${y})`);
      if (def.decor) {
        const d = def.decor;
        decor.push({
          id: d.id ?? `${spec.id}:${slug(d.name)}@${x},${y}`, name: d.name, kind: d.kind ?? "object", glyph: d.glyph, map: spec.id, at: { x, y },
          ...(d.color ? { color: d.color } : {}), ...(d.states ? { states: [...d.states] } : {}), ...(d.blocks ? { blocks: true } : {}),
          ...(d.text ? { interaction: { kind: "examine", text: d.text, label: `Look at ${d.name}` } satisfies Interaction } : {}),
        });
      }
      return { ...def.tile };
    }));
  });
  const map: TileMap = { id: spec.id, name: spec.name, width, height: rows.length, tiles, regions: spec.regions, exits: spec.exits ?? [] };
  return { map, decor };
}

export const slug = (name: string) => name.toLowerCase().replace(/^(a|an|the) /, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------------------------
// Reading maps.

export const inBounds = (map: TileMap, p: Tile2) => p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;

export function tileAt(map: TileMap, p: Tile2): MapTile {
  return (inBounds(map, p) ? map.tiles[p.y]![p.x]! : { terrain: "void", blocks: true }) as MapTile;
}

/** Walls, windows, doors and fences: built things with height that stand in the way of sight or feet. */
export const isStructure = (t: Tile) => t.terrain === "wall" || t.terrain === "window" || t.terrain === "door" || t.terrain === "fence";

/** A floor under a roof: walkable, but drawn as roof from outside (the roof lifts when you go in). */
export const isRoofed = (t: Tile) => !t.blocks && !isStructure(t) && !!(t as MapTile).roof;

export const inRect = (r: { x: number; y: number; w: number; h: number }, p: Tile2) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

/** A door, or a way out to another map (the stairs, along the wharf). */
export const isDoorway = (map: TileMap, p: Tile2) => tileAt(map, p).terrain === "door" || map.exits.some(e => e.at.x === p.x && e.at.y === p.y);

/** The smallest region containing a tile. */
export function regionAt(map: TileMap, p: Tile2): PlaceRegion | undefined {
  return (map.regions as PlaceRegion[]).filter(r => inRect(r.rect, p)).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
}

export const DIRS: Array<{ dx: number; dy: number; name: string }> = [
  { dx: 0, dy: -1, name: "north" }, { dx: 1, dy: -1, name: "north-east" }, { dx: 1, dy: 0, name: "east" }, { dx: 1, dy: 1, name: "south-east" },
  { dx: 0, dy: 1, name: "south" }, { dx: -1, dy: 1, name: "south-west" }, { dx: -1, dy: 0, name: "west" }, { dx: -1, dy: -1, name: "north-west" },
];

/** A compass word for the way from one tile to another ("here" when they're the same). */
export function direction(from: Tile2, to: Tile2): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx && !dy) return "here";
  const angle = Math.atan2(dy, dx);
  const index = (Math.round(angle / (Math.PI / 4)) + 8 + 2) % 8; // 0 = north
  return DIRS[index]!.name;
}

/** Chebyshev distance: diagonal steps count as one, as they do for moving. */
export const steps = (a: Tile2, b: Tile2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ---------------------------------------------------------------------------------------------
// v2: a map as campaign data (campaigns/<id>/maps/<key>.json), installed as a map_def row.

/** A legend entry as data: T()'s arguments (the terrain, any overrides, and the decor that stands on it). */
export type LegendEntry = { terrain: Terrain; decor?: DecorDef } & Omit<MapTile, "terrain">;

/**
 * maps/<key>.json: the prototype's MapSpec as data. The grid is its rows (north at the top), each
 * legend entry is what T() is given, and the exits are written out one by one.
 */
export interface MapFile {
  id: string;
  name: string;
  grid: string[];
  legend: Record<string, LegendEntry>;
  regions: PlaceRegion[];
  exits: TileMap["exits"];
  /** Who's about at each hour of the day (presence.ts's town: the prototype's were written in it), in the order they're met. */
  people?: MapPerson[];
}

/** Someone (or something) about on a map at some hours of the day: a sweeper in the morning, a lamplighter at dusk. */
export interface MapPerson {
  name: string;
  glyph: string;
  /** The townsfolk's colour (looks.ts) when it's not given. */
  color?: string;
  /** A person unless it says otherwise (a goose is a creature, a brazier an object). */
  kind?: MapActor["kind"];
  /** Where they stand (the nearest free spot to it, if that's taken). */
  at: Tile2;
  /** What they say when they're talked to, or what it is when it's looked at. */
  text: string;
  states?: string[];
  /** In the way unless it says not. */
  blocks?: boolean;
  /** The hours they're about. */
  times: Array<StoryState["time"]>;
}

/** A map file built as the prototype builds its maps: the tile map and the decor standing on it. */
export function mapOf(file: MapFile): MapDef {
  const legend: Record<string, TileDef> = {};
  for (const [ch, { terrain, decor, ...extra }] of Object.entries(file.legend)) legend[ch] = T(terrain, extra, decor);
  return buildMap({ id: file.id, name: file.name, grid: file.grid.join("\n"), legend, regions: file.regions, exits: file.exits });
}
