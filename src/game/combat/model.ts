import type { CombatResult, MapActor, TileMap, Tile2 } from "../types.ts";

/**
 * The fight's state as boardgame.io holds it (G): the rules engine's campaign (the truth about
 * hit points, slots, conditions and the encounter: initiative, positions, what each combatant has
 * used this turn), and a projection of it for drawing and for the AI.
 */

export type Side = "player" | "ally" | "enemy" | "neutral";
/** How the AI plays them. "player" is the player's character (the AI only drives it in the demo). */
export type Role = "player" | "ally" | "bruiser" | "villain" | "coward" | "brawler" | "archer" | "bystander";
/**
 * fighting: in it. down: at 0 hit points (the player rolls death saves; others are out cold).
 * dead: killed outright. fled: off the map. surrendered: hands up. The arrested flag is separate.
 */
export type UnitState = "fighting" | "down" | "dead" | "fled" | "surrendered";

export interface Unit {
  id: string;
  name: string;
  /** "the quiet Crake": how the dice lines and the log name them mid-sentence. */
  called: string;
  side: Side;
  role: Role;
  engineId: string;
  /** Weapon instance ids in the engine, main weapon first. */
  weapons: string[];
  /** What their main weapon is called in the fiction ("Sword-cane"), when it isn't the engine's name. */
  weaponName?: string;
  at: Tile2;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number;
  initiative: number;
  state: UnitState;
  arrested?: boolean;
  /** The engine's conditions that matter on the map (prone, dodged, unconscious...). */
  conditions: string[];
  /** The player's death saves while down. */
  deathSaves?: { successes: number; failures: number; stable: boolean };
  /** Parries left this round (Sallow's sword-cane). */
  parry?: { bonus: number; ready: boolean };
  glyph: string;
  color: string;
  castId?: string;
  /** Hurt at least once (for the summary). */
  wounded?: boolean;
}

export interface Prop {
  id: string;
  name: string;
  kind: "lantern" | "brazier" | "object";
  at: Tile2;
  ac: number;
  hp: number;
  /** A lit flame: knocked over or broken, it sets light to where it lands. */
  lit: boolean;
  state: "standing" | "fallen" | "broken";
  glyph: string;
}

export interface LogLine {
  round: number;
  /** dice: rules results (🎲 in the app). narration: what it looks like. turn: whose turn. system: notices. */
  kind: "dice" | "narration" | "turn" | "system";
  text: string;
  /** The unit it's about, when there is one. */
  who?: string;
}

export interface CombatG {
  /** The engine campaign (serializeCampaign): the source of truth for the rules. */
  campaign: string;
  /** Bumped on every change to the campaign: the key for the live copy kept in memory. */
  rev: number;
  /** The engine's dice state between moves, so a fight replays exactly from its seed. */
  rng: number;
  encounterId: string;
  map: TileMap;
  units: Record<string, Unit>;
  /** Unit ids in initiative order: boardgame.io player i is order[i]. */
  order: string[];
  /** Index in order of whose turn it is (mirrors the engine's encounter). */
  active: number;
  round: number;
  /** Tiles thick with grain dust ("x,y"). */
  dust: string[];
  /** Tiles on fire ("x,y"). */
  fire: string[];
  /** What burns if fire reaches it (sack stacks, the heap of empties): "x,y". */
  fuel: string[];
  props: Record<string, Prop>;
  log: LogLine[];
  /** Where people can leave the map (doors to the wharf, the river). */
  exits: Array<{ at: Tile2; label: string }>;
  /** The player character's unit id. */
  pc: string;
  /** Set once the fight is decided. */
  outcome?: CombatResult["outcome"];
  flags: Record<string, string | number | boolean>;
  /** The last action that couldn't be done, and why (cleared by the next one). */
  error?: string;
  /** Lines the next view should mark as new. */
  seq: number;
}

export type PlayerAction =
  | { kind: "move"; to: Tile2 }
  | { kind: "attack"; target: string; weapon?: string }
  | { kind: "cast"; spell: string; target?: string; at?: Tile2 }
  | { kind: "use"; prop: string }
  | { kind: "dash" } | { kind: "dodge" } | { kind: "disengage" }
  | { kind: "leave" }
  | { kind: "end" };

export interface ActResult { ok: boolean; error?: string; lines: LogLine[] }

/** What the player can do right now, for menus. */
export interface PlayerOptions {
  /** It's the player's turn and they can act. */
  ready: boolean;
  movementLeft: number;
  actionUsed: boolean;
  /** Tiles the player can move to this turn. */
  moves: Tile2[];
  attacks: Array<{ target: string; name: string; weapon: string; weaponName: string; bonus: number; advantage?: "advantage" | "disadvantage"; note?: string }>;
  spells: Array<{ id: string; name: string; level: number; slot: number; targeting: "unit" | "area" | "self"; area?: { shape: string; size: number }; range: number; fire: boolean; targets: Array<{ id: string; name: string }> }>;
  props: Array<{ id: string; name: string; how: string }>;
  dash: boolean;
  dodge: boolean;
  disengage: boolean;
  /** Standing on a way out: the player can leave the fight. */
  leave?: string;
}

export interface CombatView {
  map: TileMap;
  round: number;
  /** Whose turn it is. */
  turn?: { id: string; name: string; side: Side; isPlayer: boolean };
  order: Array<{ id: string; name: string; side: Side; initiative: number; state: UnitState; health: string; active: boolean }>;
  units: Unit[];
  /** Units and props as map actors, for the map module's renderer. */
  actors: MapActor[];
  hazards: { dust: Tile2[]; fire: Tile2[] };
  props: Prop[];
  log: LogLine[];
  player: { hp: number; maxHp: number; ac: number; speed: number; movementLeft: number; actionUsed: boolean; slots: string; conditions: string[]; deathSaves?: { successes: number; failures: number; stable: boolean } };
  over: boolean;
  outcome?: CombatResult["outcome"];
}
