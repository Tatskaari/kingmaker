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
  /** Who's carrying it (the lantern-boy's lantern): it goes where they go, and falls if they're hit. */
  carriedBy?: string;
}

export interface LogLine {
  round: number;
  /**
   * dice: rules results (🎲 in the app). narration: what it looks like. turn: whose turn. system:
   * notices. said: words spoken aloud (a typed line, and whoever answers it): `who` says them.
   */
  kind: "dice" | "narration" | "turn" | "system" | "said";
  text: string;
  /** The unit it's about, when there is one (who says it, for a "said" line). */
  who?: string;
}

/** A log line as the fight's text shows it: 🎲 for the dice, (brackets) for notices, › for what the player typed. */
export function show(l: LogLine): string {
  switch (l.kind) {
    case "turn": return `— ${l.text} —`;
    case "dice": return `🎲 ${l.text}`;
    case "system": return `(${l.text})`;
    // The player's own line, as typed; anyone else's words come with their name already.
    case "said": return l.who === "player" ? `› ${l.text}` : l.text;
    default: return l.text;
  }
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
  /** Bumped with every log line. */
  seq: number;
  /** The turn whose start has been dealt with ("round:index"), so a reloaded fight doesn't burn anyone twice. */
  begun?: string;
  /** Dice from the start of the coming turn (a death save), shown after its header. */
  queued?: string[];
  /** Where the fight is, for its lines ("You leave the Heron and its business behind you"): the Heron unless said. */
  place?: string;
}

/** The skills a word to someone on the other side is tried with (the Influence action). */
export type InfluenceSkill = "intimidation" | "persuasion" | "deception" | "performance";
/**
 * What they're urged to do: yield (hands up, out of the fight), go (leave it: they make for the way
 * out, and give up if they can't get there), or hold (hold back: they let their next turn go by).
 */
export type Urge = "yield" | "go" | "hold";
/**
 * How the one urged takes it (the 2024 rules' Influence: willing needs no roll; hesitant rolls, at
 * disadvantage while they're hostile, which everyone fighting you is unless the fight has gone out
 * of them). Unwilling is never rolled: it's words, and costs nothing.
 */
export type Mood = "willing" | "wavering" | "hostile";
/** The skills a look or a think is rolled with (the Search and Study actions). */
export type CheckSkill = "perception" | "insight" | "medicine" | "survival" | "investigation" | "arcana" | "history" | "nature" | "religion";

export type PlayerAction =
  | { kind: "move"; to: Tile2 }
  /** weapon: an instance id, or "improvised" (a bottle, a chair leg: the rules' unarmed strike, called what it is). */
  | { kind: "attack"; target: string; weapon?: string }
  /** slot: a higher slot than the lowest the spell can take (an upcast). */
  | { kind: "cast"; spell: string; target?: string; at?: Tile2; slot?: number }
  | { kind: "use"; prop: string }
  /** A grab (grappled: they can't move), a shove over (prone), or a shove away (pushed 5 ft): the target saves. */
  | { kind: "wrestle"; target: string; how: "grapple" | "prone" | "push" }
  /** Words with the weight of an action behind them: urging someone on the other side to give it up. */
  | { kind: "influence"; target: string; skill: InfluenceSkill; urge: Urge; mood: Mood }
  /** Looking for something, or working it out: a check the rules roll, which changes nothing on the board. */
  | { kind: "check"; skill: CheckSkill; dc: number }
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
  /** Who's close enough to grab or shove (beside you, on the other side), while the action's free. */
  wrestle: Array<{ id: string; name: string }>;
  /** Who's close enough to hear you urge them to give it up (on the other side, standing), while the action's free. */
  hear: Array<{ id: string; name: string; understands: boolean }>;
  bonusActionUsed: boolean;
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
