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

/** One styled run of text in a rendered line. */
export interface Span { text: string; fg?: string; bg?: string; bold?: boolean }
export type StyledLine = Span[];

export interface CombatantSetup {
  id: string;
  name: string;
  side: "player" | "ally" | "enemy" | "neutral";
  /** SRD statblock for NPCs; the player's sheet comes from the session's rules state. */
  statblock?: string;
  weapon?: string;
  at: Tile2;
  /** Cast id in the scene it came from, if any. */
  castId?: string;
  /** How the AI fights them: "bruiser", "villain", "coward", "ally", "brawler", "archer" (combat module; defaults by side). */
  role?: string;
  /** Their letter on the battlefield, when the name's first letter won't tell them apart (two palace guards: G and g). */
  glyph?: string;
}

export interface CombatSetup {
  map: TileMap;
  combatants: CombatantSetup[];
  /** The scene's world, for hazards (grain dust, fire, things to hide behind). */
  sceneId?: string;
  /** Seed for the dice. */
  seed: number;
  /** Things on the map that matter in a fight (lanterns, a brazier): objects that can be knocked over or set alight. */
  props?: MapActor[];
  /** Tiles thick with grain dust: fire there makes it explode (the Heron). */
  dust?: Tile2[];
  /** Tiles that burn once fire reaches them (sack stacks, a heap of empties); solid floor tiles when omitted. */
  fuel?: Tile2[];
  /** Where the fight is, as its lines say it ("the floor of the Heron coming up to meet you"): the Heron unless said. */
  place?: string;
}

export interface CombatResult {
  outcome: "victory" | "defeat" | "fled" | "surrender";
  /** For the story's hand-off: "Sallow surrendered after both Crakes fell; Kell was wounded." */
  summary: string;
  casualties: Array<{ id: string; name: string; state: "dead" | "down" | "fled" | "surrendered" | "standing" }>;
  rounds: number;
  /** Facts for the story and the map: { heron_burned: true, sallow: "arrested" }. */
  flags?: Record<string, string | number | boolean>;
  /** Where everyone ended up on the fight's map, by cast id (or the fight's own id; "player" for the player). */
  positions?: Record<string, Tile2>;
}
