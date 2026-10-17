// K's stand-in for the town unit (v2/docs/town-design.md §2): package S copies the prototype's src/game/town-world.ts at 44c6d4a here whole, with its edits (ES2021: structuredClone is a JSON copy; `talkable` is "walks with the player", since the client has no lore; sceneThings reads the waiting places' worlds, ExploreState.waiting, not place specs). The types and signatures below are the copy's; feetOf and tileOfFeet are its own already.
import type { Entity, SceneWorld } from "../world/scene-world.ts";
import type { ExploreState } from "./explore.ts";
import type { MapActor, Region, Tile2, TileMap } from "./types.ts";

/**
 * The town's world (town-design §3.3): a map's own things, what played scenes left in their places,
 * the people about and the player, as a scene world the rules can act on outside scenes, its feet
 * from the map's corner, 5 ft a tile. Built fresh for each act from what the map has (actorsHere,
 * with ExploreState.overlay.town, which exploreOf fills from the map's place row); keepTown writes
 * back what the rules changed, into ex.overlay.town, which the simulation keeps as place.town.
 */

/** Someone or something of a place whose scene is still to come: the scene's, not the town's. */
export interface Waiting {
  /** Its id in the scene's world (a cast id, or a thing's id there). */
  id: string;
  sceneId: string;
  at: Tile2;
  name: string;
  /** Someone (Kell, Moll), not something (the yard gate). */
  person: boolean;
  /** The scene can open now (it's the lead): what's done to them opens it. Otherwise it's for later in the story. */
  live: boolean;
  states: string[];
}

export interface TownWorld {
  world: SceneWorld;
  map: TileMap;
  /** The whole map, its (0, 0) feet at the map's corner. */
  region: Region;
  /** Everyone and everything the map has here (actorsHere), as the world was built from them. */
  mapActors: MapActor[];
  /** What the map drew for each entity (by entity id). */
  actors: Map<string, MapActor>;
  /** The people and things of places whose scene is still to come (the lead's place, unplayed): by actor id. */
  waiting: Map<string, Waiting>;
  /** How everything was when it was built (states and hit points), to tell what the rules changed. */
  before: Map<string, string>;
  /** The world live on the map that this one is (a zoo wing's): what the rules do is kept there. Never set in v2. */
  roam?: SceneWorld;
}

export const FEET = 5;
/** A tile's middle, in the town world's feet. */
export const feetOf = (t: Tile2) => ({ x: t.x * FEET + FEET / 2, y: t.y * FEET + FEET / 2 });
/** The tile a point in the town world's feet is on. */
export const tileOfFeet = (p: { x: number; y: number }): Tile2 => ({ x: Math.floor(p.x / FEET), y: Math.floor(p.y / FEET) });

const notBuilt = (what: string) => new Error(`not built: shared/map/town-world.ts ${what} is package S's (town-design §2)`);

/** Build the town's world for the map the player is on. */
export function townWorld(_ex: ExploreState): TownWorld {
  throw notBuilt("townWorld");
}

/** The entity standing for a tile: who's on it (people first), else what's on it; undefined for bare ground. */
export function entityAt(_tw: TownWorld, _at: Tile2, _options: { people?: boolean; things?: boolean; self?: boolean } = {}): Entity | undefined {
  throw notBuilt("entityAt");
}

/** Keep what the rules did to the town's world: on the map from now on (ex.overlay.town), and in the saved game. What changed, in a few words. */
export function keepTown(_ex: ExploreState, _tw: TownWorld): string[] {
  throw notBuilt("keepTown");
}

/** Someone who walks with the player (Kell): what's done to them is a talk's to play. */
export function companion(_tw: TownWorld, _id: string): Entity | undefined {
  throw notBuilt("companion");
}
