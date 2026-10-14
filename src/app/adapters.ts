import type { CombatantSetup, CombatResult, CombatSetup, Interaction, MapActor, Region, StoryState, StyledLine, Tile2, TileMap } from "../game/types.ts";
import type { SessionState } from "../runtime/session.ts";
import { standInMap } from "./standins/map.ts";
import { standInCombat } from "./standins/combat.ts";

/**
 * The seams between the app and the two modules being built alongside it: the map and exploration
 * (src/game/map) and combat (src/game/combat). The app only talks to these interfaces. Until the
 * real modules land it runs on stand-ins (./standins): a small top-down town and a few dice rolls
 * through src/rules/dnd.ts. Swapping one in is the one line at the bottom of this file.
 */

export type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Where the player stands on the map. */
export interface Position { map: string; at: Tile2; facing: Dir }

/** What a step did: where the player ended up, what to tell them, and whether it opens something. */
export interface StepResult {
  pos: Position;
  /** A line for the message bar ("A wall. It has seen off better investigators than you."). */
  message?: string;
  /** Stepping here opens something: the lead scene's place, a door to another map. */
  trigger?: Interaction;
}

export interface MapView {
  map: TileMap;
  /** The cell the view centres on (the player in explore mode, the acting combatant in a fight). */
  centre: Tile2;
  actors: MapActor[];
  story: StoryState;
  /** In terminal cells. */
  width: number;
  height: number;
  /** Tiles to pick out: the acting combatant, reachable tiles. */
  highlight?: Tile2[];
  /** A selected tile or target (drawn in the danger colour). */
  target?: Tile2;
}

/** The battlefield for a scene's fight, with where each side starts. */
export interface CombatField {
  map: TileMap;
  spots: { player: Tile2; allies: Tile2[]; enemies: Tile2[]; neutrals: Tile2[] };
}

/**
 * The map and exploration (owner: src/game/map). Maps are plain TileMaps (src/game/types.ts);
 * everything that depends on where the story is takes its StoryState.
 */
export interface MapAdapter {
  /** Where a new game starts: the lane by the granary gate, Kell waiting in the yard. */
  start(): Position;
  /** A map by id. */
  map(id: string): TileMap;
  /** Who and what is on a map at this point in the story (time of day, the lead, what's been played). */
  actors(mapId: string, story: StoryState): MapActor[];
  /** One step in a direction: walls, water and people block; a step into the lead's place triggers its scene. */
  step(pos: Position, dir: Dir, actors: MapActor[], story: StoryState): StepResult;
  /** People and things in sight, nearest first, with distance in tiles (for the sidebar). */
  nearby(pos: Position, actors: MapActor[], radius?: number): Array<{ actor: MapActor; distance: number }>;
  /** What the player can interact with from where they stand: adjacent, the one they face first. */
  reachable(pos: Position, actors: MapActor[]): MapActor[];
  /** The named place the player stands in. */
  regionAt(mapId: string, at: Tile2): Region | undefined;
  /** Where a scene is played (the lead marker and the sidebar's "lead" line). */
  sceneLocation(sceneId: string): { map: string; at: Tile2; name: string } | undefined;
  /** Where the player stands when a scene played here is over (outside, so it doesn't open again). */
  afterScene(sceneId: string, before: Position): Position;
  /** The view: `height` styled lines of `width` cells. The real module draws it isometric. */
  render(view: MapView): StyledLine[];
  /** The battlefield when a scene ends in a fight. */
  combatField(sceneId: string): CombatField;
}

/** One combatant as the app shows it. */
export interface CombatantView {
  id: string;
  name: string;
  side: CombatantSetup["side"];
  at: Tile2;
  initiative: number;
  /** For the tracker: exact for the player ("HP 13/24"), in words for others ("badly hurt"). */
  health: string;
  /** Out of the fight: down, dead, fled or surrendered. */
  out: boolean;
  /** Dodging, surrendered, prone... */
  states: string[];
  glyph: string;
  color: string;
}

export interface CombatView {
  round: number;
  /** Everyone, in initiative order. */
  order: CombatantView[];
  /** Whose turn it is (a combatant id). */
  current: string;
  /** The player's turn: feet of movement left, and whether the action is spent. */
  movementLeft: number;
  actionUsed: boolean;
  /** Every log line so far, oldest first. */
  log: string[];
  /** Set when the fight is over. */
  over?: CombatResult;
}

export type CombatAction =
  | { kind: "move"; dir: Dir }
  | { kind: "attack"; target: string; weapon?: string }
  | { kind: "cast"; spell: string; target?: string }
  | { kind: "dash" } | { kind: "dodge" } | { kind: "disengage" } | { kind: "end" };

export interface CombatOptions {
  /** Spells the player could cast now (cantrips, prepared spells with a slot). */
  spells: Array<{ id: string; name: string; level: number }>;
  /** Who the player could aim at, nearest first, and whether the current weapon reaches. */
  targets: Array<{ id: string; name: string; side: CombatantSetup["side"]; distance: number; inReach: boolean }>;
}

/**
 * A fight in progress (owner: src/game/combat, over a boardgame.io headless game). The app calls
 * advance() to play out everyone else's turns, one at a time so the log can show them landing,
 * and act() on the player's turn.
 */
export interface CombatController {
  view(): CombatView;
  options(): Promise<CombatOptions>;
  /** The player's move on their turn. Returns the new log lines. */
  act(action: CombatAction): Promise<string[]>;
  /** One turn for whoever acts next when it isn't the player. Returns the new log lines. */
  advance(): Promise<string[]>;
  /** The fight's outcome, once it's over: its summary feeds chainScene. */
  result(): CombatResult | undefined;
  /** The combatants as map actors, for the map renderer. */
  actors(): MapActor[];
}

export interface CombatAdapter {
  /** Roll initiative and set up the fight. The player's sheet comes from the session's rules state. */
  start(setup: CombatSetup, session: SessionState): Promise<CombatController>;
}

// The active modules. To swap in the real ones, change these two lines, e.g.
//   export const maps: MapAdapter = townMap;        // import { townMap } from "../game/map/index.ts"
//   export const combat: CombatAdapter = boardgameCombat;   // import { boardgameCombat } from "../game/combat/index.ts"
export const maps: MapAdapter = standInMap;
export const combat: CombatAdapter = standInCombat;
