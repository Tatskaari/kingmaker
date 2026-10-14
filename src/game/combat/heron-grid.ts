import type { MapActor, Region, Tile, TileMap, Tile2 } from "../types.ts";

/**
 * The Heron warehouse's floor as a tile map (5 ft tiles; x runs east from the land door to the river
 * door), until the map module's own Heron (spike/map) takes over: heronEncounter works on any
 * TileMap and falls back to what it can infer, so this swaps out.
 *
 *   #  tarred timber wall          S  palace sacks, stacked (wheat-ear stamp)   H  heron sacks, stacked
 *   D  the land door (wharf)       R  the river door (plank walk, barge)        h  heap of empty sacks
 *   w  counting-box glass          c  counting-box floor (raised)               s  its stair
 *
 * The re-sacking floor between the stacks is thick with grain dust; the ends by the doors and the
 * counting box are clear of it. The brazier stands just outside the dust at the river end.
 */

export const HERON_MAP_ID = "heron-interior";

const ROWS = [
  "##############################",
  "#.....SSSSSS....SSSSSS..wcccc#",
  "#.....SSSSSS....SSSSSS..wcccc#",
  "#.......................wcccc#",
  "#.......................wwsww#",
  "D............................#",
  "D............................R",
  "#............................R",
  "#............................#",
  "#.....HHHHHH....HHHHHH...hh..#",
  "#.....HHHHHH....HHHHHH...hh..#",
  "##############################",
];

function tile(ch: string): Tile {
  switch (ch) {
    case "#": return { terrain: "wall", blocks: true, opaque: true, height: 3 };
    case "S": case "H": return { terrain: "floor", blocks: true, opaque: true, height: 2 };
    case "D": case "R": return { terrain: "door" };
    case "w": return { terrain: "window", blocks: true, height: 2 };
    case "c": return { terrain: "boards", height: 1 };
    case "s": return { terrain: "stairs" };
    default: return { terrain: "boards" };
  }
}

const at = (x: number, y: number): Tile2 => ({ x, y });

export function heronMap(): TileMap {
  const regions: Region[] = [
    { id: "heron-floor", name: "The Heron warehouse", rect: { x: 0, y: 0, w: 30, h: 12 }, sceneId: "heron-warehouse", worldOrigin: { x: 0, y: 0 } },
    { id: "counting-box", name: "the counting-box", rect: { x: 24, y: 1, w: 5, h: 4 } },
  ];
  return {
    id: HERON_MAP_ID,
    name: "The Heron warehouse",
    width: ROWS[0]!.length,
    height: ROWS.length,
    tiles: ROWS.map(row => [...row].map(tile)),
    regions,
    exits: [
      { at: at(0, 5), to: { map: "wharf", at: at(0, 0) }, label: "the land door" },
      { at: at(0, 6), to: { map: "wharf", at: at(0, 0) }, label: "the land door" },
      { at: at(29, 6), to: { map: "river", at: at(0, 0) }, label: "the river door" },
      { at: at(29, 7), to: { map: "river", at: at(0, 0) }, label: "the river door" },
    ],
  };
}

/** What the Heron's grid knows that a TileMap can't say: where the dust is, what burns, the lights, where people stand. */
export const HERON_LAYOUT = {
  /** The re-sacking floor between the stacks (x 5 to 21). */
  dust: (map: TileMap): Tile2[] => cells(map, (x, y) => x >= 5 && x <= 21 && y >= 1 && y <= 10 && ROWS[y]![x] === "."),
  /** Sack stacks and the heap of empties. */
  fuel: (map: TileMap): Tile2[] => cells(map, (x, y) => "SHh".includes(ROWS[y]![x]!)),
  props: (map: TileMap): MapActor[] => [
    { id: "brazier", name: "brazier", kind: "object", glyph: "&", color: "#ff7f2a", map: map.id, at: at(22, 8), states: ["lit"] },
    { id: "lantern-west", name: "hanging lantern", kind: "object", glyph: "o", color: "#ffd966", map: map.id, at: at(8, 4), states: ["lit"] },
    { id: "lantern-middle", name: "hanging lantern", kind: "object", glyph: "o", color: "#ffd966", map: map.id, at: at(13, 8), states: ["lit"] },
    { id: "lantern-east", name: "hanging lantern", kind: "object", glyph: "o", color: "#ffd966", map: map.id, at: at(19, 3), states: ["lit"] },
    { id: "boys-lantern", name: "lantern on a pole", kind: "object", glyph: "o", color: "#ffd966", map: map.id, at: at(11, 7), ref: "lantern-boy", states: ["lit", "carried"] },
  ],
  /** Where people stand when it starts: the player and Kell at the river end, Sallow mid-floor behind his Crakes. */
  starts: {
    player: at(22, 6), kell: at(22, 5), kellWharf: at(1, 5),
    sallow: at(12, 6), "crake-1": at(15, 5), "crake-2": at(15, 7), "lantern-boy": at(11, 7),
    hep: at(13, 6), porters: [at(15, 4), at(15, 8), at(16, 6), at(12, 4)],
  },
};

function cells(map: TileMap, keep: (x: number, y: number) => boolean): Tile2[] {
  const out: Tile2[] = [];
  for (let y = 0; y < Math.min(map.height, ROWS.length); y++) for (let x = 0; x < Math.min(map.width, ROWS[0]!.length); x++) if (keep(x, y)) out.push({ x, y });
  return out;
}
