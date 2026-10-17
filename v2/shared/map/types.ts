// Copied from the prototype's src/game/types.ts:1-81 at 44c6d4a (Tile2 to StoryState), unchanged: the map's contract, which the simulation and the client both read (Span and StyledLine are the client's, in client/ui/types.ts).
/**
 * The contract between the playable game's modules (docs/design/playable.md): the map and
 * exploration, combat, and the app. The scene runtime (src/runtime), the rules (src/rules) and the
 * scene world (src/world) keep their own types; these are the seams between them.
 */

export interface Tile2 { x: number; y: number }

export type Terrain =
  | "floor" | "boards" | "cobbles" | "grass" | "dirt" | "water" | "deep-water" | "stairs"
  | "wall" | "door" | "window" | "fence" | "tree" | "bridge" | "void";

export interface Tile {
  terrain: Terrain;
  /** Blocks movement (walls, deep water, a closed locked door). */
  blocks?: boolean;
  /** Blocks sight (walls, closed doors). */
  opaque?: boolean;
  /** Raised tiles draw taller in the isometric view (0 = ground). */
  height?: number;
}

/** A named part of a map: a room, a yard, a street. Regions with a scene open it when triggered. */
export interface Region {
  id: string;
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  /** The scene played here, if any. */
  sceneId?: string;
  /** Where the scene world's (0, 0) feet sits, in tiles (5 ft per tile). */
  worldOrigin?: Tile2;
}

export interface TileMap {
  id: string;
  name: string;
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: Tile[][];
  regions: Region[];
  /** Doors and paths to other maps. */
  exits: Array<{ at: Tile2; to: { map: string; at: Tile2 }; label: string }>;
}

/** Something on the map that isn't terrain: people, creatures, objects, items. */
export interface MapActor {
  id: string;
  name: string;
  kind: "player" | "person" | "creature" | "object" | "item";
  glyph: string;
  /** Hex colour for the renderer. */
  color?: string;
  map: string;
  at: Tile2;
  /** A cast id in the current scene, or a scene-world entity id. */
  ref?: string;
  /** States worth drawing (burning, destroyed, down...). */
  states?: string[];
  /** A stack's count (three pennies on the cobbles), from the scene's world. */
  quantity?: number;
  blocks?: boolean;
  /** What happens when the player interacts with it. */
  interaction?: Interaction;
}

export type Interaction =
  | { kind: "scene"; sceneId: string; verb: "talk" | "enter" | "open" | "examine"; label: string }
  | { kind: "travel"; to: { map: string; at: Tile2 }; label: string }
  | { kind: "examine"; text: string; label: string };

/** Where the story is, as the map needs to know it. */
export interface StoryState {
  time: "morning" | "afternoon" | "evening" | "night" | "next-morning";
  /** Scenes already played, in order. */
  played: string[];
  /** The scene the story is heading for (its location is the lead on the map). */
  lead?: string;
  flags: Record<string, string | number | boolean>;
}

