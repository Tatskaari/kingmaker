// After the prototype's zoo arena (src/game/zoo/arenas.ts and wings/arena.ts at bc2ab1f: the wolf run, the goblin pit, the porters' floor and the grain floor, each with who fights there and how) and its Heron grid (src/game/combat/heron-grid.ts: the grain floor's tiles, dust, sacks, lights and starts), as setups for startFight, each ring on a map of its own; and a practice ring with one bandit, new, for a quick fight (M6). Shared (it was the simulation's), so the client can list the rings to start one from its menu.
import type { FightSetup } from "../fight/types.ts";
import type { LegendEntry, MapFile } from "../map/tiles.ts";
import type { CombatantSetup, MapActor, Tile2 } from "../map/types.ts";

/**
 * The zoo's arena (docs/combat-design.md §7): rings to start a fight in, for QA and for the user to
 * play with. Each is a setup's makings: its map (its own: none is the campaign's), who fights there
 * with their statblock, weapon and how the AI plays them, where everyone stands, and its hazards.
 * The player starts rested in every ring (fresh), and the ring leaves their sheet as it was (no keep):
 * it's practice. Kell fights beside you in the grain floor's.
 */
export interface Ring {
  id: string;
  /** "The wolf run". */
  title: string;
  /** What it's for, a line. */
  about: string;
  map: MapFile;
  /** Everyone but the player: their statblock, side, role and where they start. */
  fighters: Array<Omit<CombatantSetup, "at"> & { at: Tile2 }>;
  /** Where the player starts. */
  start: Tile2;
  props?: MapActor[];
  dust?: Tile2[];
  fuel?: Tile2[];
}

/** Where every ring's lines say the fight is ("You leave the Arena and its business behind you, fast"). */
export const ARENA = "the Arena";

/** A ring's fight, for the player: their name, its people and its map, the player rested, their sheet left as it was. */
export function ringSetup(ring: Ring, player: { name: string }, options: { fast?: boolean } = {}): FightSetup {
  return {
    title: ring.title, place: ARENA, map: { file: ring.map },
    combatants: [{ id: "player", name: player.name, side: "player", role: "player", at: { ...ring.start } }, ...ring.fighters.map(f => ({ ...f, at: { ...f.at } }))],
    ...(ring.props ? { props: ring.props.map(p => ({ ...p, at: { ...p.at } })) } : {}),
    ...(ring.dust ? { dust: ring.dust } : {}), ...(ring.fuel ? { fuel: ring.fuel } : {}),
    fresh: true, ...(options.fast ? { fast: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The rings' maps: grids in the map format's legend characters (shared/map/tiles.ts MapFile),
// with letters for where people and things start, read off and floored over.

/** A grid's marked spots (each marker once), and its rows with the markers floored over with `floor`. */
function marked(rows: string[], markers: string, floor: string): { grid: string[]; at: Record<string, Tile2> } {
  const at: Record<string, Tile2> = {};
  const grid = rows.map((row, y) => [...row].map((ch, x) => {
    if (!markers.includes(ch)) return ch;
    if (at[ch]) throw new Error(`rings: the marker ${ch} is in the grid twice`);
    at[ch] = { x, y };
    return floor;
  }).join(""));
  for (const ch of markers) if (!at[ch]) throw new Error(`rings: the marker ${ch} isn't in the grid`);
  return { grid, at };
}

/** A ring's map file: its grid and legend, no regions, and its gates as ways out. */
function mapFile(id: string, name: string, grid: string[], legend: Record<string, LegendEntry>, gates: Array<{ at: Tile2; label: string }>): MapFile {
  return { id, name, grid, legend, regions: [], exits: gates.map(g => ({ at: { ...g.at }, to: { map: id, at: { ...g.at } }, label: g.label })) };
}

const WALL: LegendEntry = { terrain: "wall", style: "timber", height: 2 };
const GATE: LegendEntry = { terrain: "door", style: "timber", height: 2 };
const ROCK: LegendEntry = { terrain: "wall", style: "stone", height: 1 };
const TRESTLE: LegendEntry = { terrain: "fence", style: "timber", height: 1 };
const TREE: LegendEntry = { terrain: "tree" };

/** Where on a grid a character is, every time. */
function cells(rows: string[], chars: string): Tile2[] {
  const out: Tile2[] = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (chars.includes(ch)) out.push({ x, y }); }));
  return out;
}

// The practice ring: one bandit, for a quick fight (and the tests').
const PRACTICE = marked([
  "############",
  "#..........#",
  "#..........#",
  "#.@......B.#",
  "#..........#",
  "#..........#",
  "#####+######",
], "@B", ".");

// The wolf run: three wolves in long grass, two trees to put your back to (prototype's wolf run).
const WOLVES = marked([
  "##############",
  "#,,,,,,,,,,,,#",
  "#,,1,,,,,,2,,#",
  "#,,,,T,,,,,,,#",
  "#,,,,,,,,,,,,#",
  "#,,,,,,,,3,,,#",
  "#,,,,,,,T,,,,#",
  "#,,,,,,,,,,,,#",
  "#,,,,,,,,,,,,#",
  "#,,,@,,,,,,,,#",
  "#,,,,,,,,,,,,#",
  "######+#######",
], "123@", ",");

// The goblin pit: a boss and a goblin with scimitars, two archers who keep their distance behind the rocks (the prototype's goblin pit).
const GOBLINS = marked([
  "################",
  "#..............#",
  "#.a..........b.#",
  "#....o....o....#",
  "#......G.......#",
  "#...g..........#",
  "#..............#",
  "#.......o......#",
  "#..............#",
  "#......@.......#",
  "#..............#",
  "#######+########",
], "abGg@", ".");

// The porters' floor: Hep Grist and three porters, brawlers who gang up (the prototype's porters' floor, Hep's gang before midnight at the Heron).
const PORTERS = marked([
  "############",
  "#..........#",
  "#.H..1.....#",
  "#....2.....#",
  "#..ttt..3..#",
  "#..........#",
  "#..........#",
  "#....@.....#",
  "#..........#",
  "#####+######",
], "H123@", ".");

// The grain floor: the Heron rehearsed on the prototype's own Heron grid (src/game/combat/heron-grid.ts), its dust, sacks and lights.
const HERON_ROWS = [
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
const at = (x: number, y: number): Tile2 => ({ x, y });

export const RINGS: Record<string, Ring> = {
  practice: {
    id: "practice", title: "The practice ring", about: "One bandit with a scimitar, for a quick fight.",
    map: mapFile("zoo-practice", "The practice ring", PRACTICE.grid, { "#": WALL, ".": { terrain: "floor" }, "+": GATE }, [{ at: at(5, 6), label: "the gate" }]),
    start: PRACTICE.at["@"]!,
    fighters: [{ id: "bandit", name: "a bandit", side: "enemy", role: "brawler", statblock: "bandit", at: PRACTICE.at["B"]! }],
  },
  wolves: {
    id: "wolves", title: "The wolf run", about: "Three wolves (Pack Tactics: they come in together, from the sides). Keep your back to a tree.",
    map: mapFile("zoo-wolves", "The wolf run", WOLVES.grid, { "#": WALL, ",": { terrain: "grass" }, T: TREE, "+": GATE }, [{ at: at(6, 11), label: "the gate" }]),
    start: WOLVES.at["@"]!,
    fighters: [
      { id: "wolf-1", name: "a grey wolf", side: "enemy", role: "bruiser", statblock: "wolf", glyph: "W", at: WOLVES.at["1"]! },
      { id: "wolf-2", name: "a big grey wolf", side: "enemy", role: "bruiser", statblock: "wolf", glyph: "W", at: WOLVES.at["2"]! },
      { id: "wolf-3", name: "a lean grey wolf", side: "enemy", role: "bruiser", statblock: "wolf", glyph: "w", at: WOLVES.at["3"]! },
    ],
  },
  goblins: {
    id: "goblins", title: "The goblin pit", about: "A goblin boss, a goblin, and two archers who keep their distance behind the rocks: shots want a clear line, and someone in the way is half cover.",
    map: mapFile("zoo-goblins", "The goblin pit", GOBLINS.grid, { "#": WALL, ".": { terrain: "dirt" }, o: ROCK, "+": GATE }, [{ at: at(7, 11), label: "the gate" }]),
    start: GOBLINS.at["@"]!,
    fighters: [
      { id: "goblin-boss", name: "the goblin boss", side: "enemy", role: "bruiser", statblock: "goblin-boss", weapon: "scimitar", glyph: "G", at: GOBLINS.at["G"]! },
      { id: "goblin", name: "a goblin", side: "enemy", role: "brawler", statblock: "goblin-warrior", weapon: "scimitar", glyph: "g", at: GOBLINS.at["g"]! },
      { id: "goblin-archer-1", name: "a goblin archer", side: "enemy", role: "archer", statblock: "goblin-warrior", weapon: "shortbow", glyph: "a", at: GOBLINS.at["a"]! },
      { id: "goblin-archer-2", name: "another goblin archer", side: "enemy", role: "archer", statblock: "goblin-warrior", weapon: "shortbow", glyph: "a", at: GOBLINS.at["b"]! },
    ],
  },
  porters: {
    id: "porters", title: "The porters' floor", about: "Hep Grist and three of her porters, brawlers with sack-knives who gang up and don't stop to talk.",
    map: mapFile("zoo-porters", "The porters' floor", PORTERS.grid, { "#": WALL, ".": { terrain: "boards" }, t: TRESTLE, "+": GATE }, [{ at: at(5, 9), label: "the gate" }]),
    start: PORTERS.at["@"]!,
    fighters: [
      { id: "hep", castId: "hep", name: "Hepzibah Grist", side: "enemy", role: "brawler", statblock: "tough", weapon: "dagger", at: PORTERS.at["H"]! },
      { id: "porter-1", name: "a floury porter", side: "enemy", role: "brawler", statblock: "porter", glyph: "P", at: PORTERS.at["1"]! },
      { id: "porter-2", name: "a porter with a sack-needle", side: "enemy", role: "brawler", statblock: "porter", glyph: "P", at: PORTERS.at["2"]! },
      { id: "porter-3", name: "a big porter", side: "enemy", role: "brawler", statblock: "porter", glyph: "P", at: PORTERS.at["3"]! },
    ],
  },
  heron: {
    id: "heron", title: "The grain floor", about: "The Heron's fight rehearsed: Master Sallow (a sword-cane duellist who parries), the talking Crake and the silent Crake, and the lantern-boy, in the grain dust, with lanterns, a brazier, sacks to catch, and Kell beside you.",
    map: mapFile("zoo-heron", "The grain floor", HERON_ROWS, {
      "#": { terrain: "wall", style: "tar", height: 3 }, S: { terrain: "wall", style: "granary", height: 2 }, H: { terrain: "wall", style: "granary", height: 2 },
      h: { terrain: "wall", style: "granary", height: 1 }, D: { terrain: "door", style: "tar", height: 3 }, R: { terrain: "door", style: "tar", height: 3 },
      w: { terrain: "window", style: "panel", height: 2 }, c: { terrain: "boards", height: 1 }, s: { terrain: "stairs" }, ".": { terrain: "boards" },
    }, [{ at: at(0, 5), label: "the land door" }, { at: at(0, 6), label: "the land door" }, { at: at(29, 6), label: "the river door" }, { at: at(29, 7), label: "the river door" }]),
    start: at(22, 6),
    fighters: [
      { id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", role: "ally", statblock: "guard", weapon: "club", at: at(22, 5) },
      { id: "sallow", castId: "sallow", name: "Master Josiah Sallow", side: "enemy", role: "villain", statblock: "sword-cane-duellist", at: at(12, 6) },
      { id: "crake-1", castId: "crake-1", name: "the talking Crake", side: "enemy", role: "bruiser", statblock: "river-bruiser", at: at(15, 5) },
      { id: "crake-2", castId: "crake-2", name: "the silent Crake", side: "enemy", role: "bruiser", statblock: "river-bruiser", at: at(15, 7) },
      { id: "lantern-boy", castId: "lantern-boy", name: "the lantern-boy", side: "enemy", role: "coward", statblock: "lantern-boy", at: at(4, 7) },
    ],
    props: [
      { id: "brazier", name: "brazier", kind: "object", glyph: "&", color: "#ff7f2a", map: "zoo-heron", at: at(22, 8), states: ["lit"] },
      { id: "lantern-west", name: "hanging lantern", kind: "object", glyph: "o", color: "#ffd966", map: "zoo-heron", at: at(8, 4), states: ["lit"] },
      { id: "lantern-middle", name: "hanging lantern", kind: "object", glyph: "o", color: "#ffd966", map: "zoo-heron", at: at(13, 8), states: ["lit"] },
      { id: "lantern-east", name: "hanging lantern", kind: "object", glyph: "o", color: "#ffd966", map: "zoo-heron", at: at(19, 3), states: ["lit"] },
      { id: "boys-lantern", name: "lantern on a pole", kind: "object", glyph: "o", color: "#ffd966", map: "zoo-heron", at: at(4, 7), ref: "lantern-boy", states: ["lit", "carried"] },
    ],
    // The re-sacking floor between the stacks is thick with grain dust; the stacks and the heap of empties burn.
    dust: cells(HERON_ROWS, ".").filter(t => t.x >= 5 && t.x <= 21 && t.y >= 1 && t.y <= 10),
    fuel: cells(HERON_ROWS, "SHh"),
  },
};
