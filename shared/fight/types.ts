// After the prototype's src/game/combat/model.ts at bc2ab1f: Side, Role, UnitState, Unit, Prop and LogLine as they are (LogLine's "said" kind is a typed line's, V13's, and goes); CombatG as FightBoard (the engine's campaign, its rng and the map are kept apart: fight_rules has the campaign, the fight row the map), with the setup's flags it plays by. New (M6, docs/combat-design.md): the fight's setup, its events (each one moment the screen plays, with its caption) and the player's options as the fight row carries them.
import type { CombatantSetup, MapActor, Tile2 } from "../map/types.ts";
import type { MapFile } from "../map/tiles.ts";
import type { TimeOfDay } from "../scene/files.ts";

/**
 * A fight on a map, as the simulation keeps it and a client reads it (docs/combat-design.md): who's
 * in it and where (the board), what happened, a moment at a time (the events), and what the player
 * can do on their turn (the options). The rules engine's campaign, the truth about hit points, slots
 * and conditions, is the simulation's own (fight_rules); the board is its projection.
 */

export type Side = "player" | "ally" | "enemy" | "neutral";
/** How the AI plays them. "player" is the player's character (the AI only drives it when asked: auto). */
export type Role = "player" | "ally" | "bruiser" | "villain" | "coward" | "brawler" | "archer" | "bystander";
/**
 * fighting: in it. down: at 0 hit points (the player rolls death saves; others are out cold).
 * dead: killed outright. fled: off the map. surrendered: hands up. The arrested flag is separate.
 */
export type UnitState = "fighting" | "down" | "dead" | "fled" | "surrendered";

export interface Unit {
  id: string;
  name: string;
  /** "the quiet Crake": how the dice lines and the captions name them mid-sentence ("you" for the player). */
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

/** A line of the fight's log: dice (rules results), narration (what it looks like), turn (whose turn), system (notices). `who` is the unit it's about. */
export interface LogLine {
  round: number;
  kind: "dice" | "narration" | "turn" | "system";
  text: string;
  who?: string;
}

/**
 * How a fight ended: no enemy able to fight (victory); their leader yielded, or the last of them put
 * their hands up (surrender); nobody able on the player's side (defeat); the player went out of a
 * way out (fled); the player put their own hands up (yielded).
 */
export type FightOutcome = "victory" | "defeat" | "surrender" | "fled" | "yielded";

/**
 * The fight's board (the prototype's CombatG, less the engine's campaign and the map): who's where
 * and how, whose turn, the hazards, the props, the ways out, and the flags the rules and the AI keep.
 * The fight row carries it as JSON.
 */
export interface FightBoard {
  /** The engine's encounter. */
  encounterId: string;
  units: Record<string, Unit>;
  /** Unit ids in initiative order. */
  order: string[];
  /** Index in order of whose turn it is (mirrors the engine's encounter). */
  active: number;
  round: number;
  /** Tiles thick with grain dust ("x,y"). */
  dust: string[];
  /** Tiles on fire ("x,y"). */
  fire: string[];
  /** What burns if fire reaches it ("x,y"). */
  fuel: string[];
  props: Record<string, Prop>;
  /** Where people can leave the map. */
  exits: Array<{ at: Tile2; label: string }>;
  /** The player character's unit id. */
  pc: string;
  /** Set once the fight is decided. */
  outcome?: FightOutcome;
  flags: Record<string, string | number | boolean>;
  /** The turn whose start has been dealt with ("round:index"), so nothing happens twice at its start. */
  begun?: string;
  /** Dice from the start of the coming turn (a death save), shown with its header. */
  queued?: string[];
  /** Where the fight is, for its lines ("the Arena's wolf run"). */
  place: string;
  /** The setup's: the player's hit points, slots and conditions go back to the sheet at the end. */
  keep?: boolean;
  /** The setup's: the other side's turns at once, with no pause for the screen. */
  fast?: boolean;
  /** The setup's: the zoo's exhibit and line-up it was set out from (M6), for fighting it again. */
  zoo?: ZooFight;
  /** The setup's: when it happens, for the board's light (the zoo's ring in the afternoon); none, and a screen goes by its lights. */
  time?: TimeOfDay;
}

/** Which of the zoo's exhibits a fight was set out from, and with which line-up of foes (shared/zoo/exhibits.ts). */
export interface ZooFight {
  exhibit: string;
  foes: string;
}

/**
 * A fight to start (docs/combat-design.md §1): where it is, on what map, who's in it with their
 * statblocks and sides and where they stand (the player is the combatant on side "player"), the
 * lights to knock over, the grain dust and what burns. startFight takes one; the zoo's rings make them.
 */
export interface FightSetup {
  /** What it's called on screen: "The wolf run". */
  title: string;
  /** Where it is in words, for its lines ("You leave the Arena and its business behind you"). */
  place: string;
  /** The campaign's map it's fought on (by key), or one of its own (a zoo ring's). */
  map: { key: string } | { file: MapFile };
  combatants: CombatantSetup[];
  /** Lit flames a fight can knock over (lanterns, braziers): a lantern carried by someone has their id as its ref. */
  props?: MapActor[];
  dust?: Tile2[];
  /** What burns once fire reaches it; none when it doesn't say. */
  fuel?: Tile2[];
  /** The player starts rested (hit points and slots back), on the fight's own copy of their character: practice. */
  fresh?: boolean;
  /** The player's hit points, slots and conditions are written back to their sheet at the end (the story's fights); else the sheet stays as it was. */
  keep?: boolean;
  /** The other side's turns follow each other at once, with no pause for the screen (QA). */
  fast?: boolean;
  /** The zoo's exhibit and line-up it's set out from (M6): a zoo fight, which the screen offers to fight again or with other foes. */
  zoo?: ZooFight;
  /** When it happens (its scene's time of day), for the board's light. */
  time?: TimeOfDay;
}

// ---------------------------------------------------------------------------------------------
// Events: each a moment the screen plays (docs/combat-design.md §3).

/**
 * What a moment was: the fight's start (initiative rolled), a turn's start, a move (its path), an
 * attack (a blow or a shot, an opportunity attack among them), a spell, a dash, a dodge, a
 * disengage, a shove or a grab, a prop used, something said (a remark, a nerve tested), someone
 * yielding, fleeing or walking off, an arrest, the fire or the dust, a turn passing by itself, and
 * the fight's end.
 */
export type FightEventKind =
  | "start" | "turn" | "move" | "attack" | "cast" | "dash" | "dodge" | "disengage" | "wrestle" | "use"
  | "say" | "nerve" | "yield" | "flee" | "walk-off" | "arrest" | "hazard" | "pass" | "over";

/** An attack roll, as the engine rolled it: who at whom with what, the d20s, the bonus, the total against the armour class. */
export interface FightRoll {
  by: string;
  target: string;
  with: string;
  d20: number[];
  bonus: number;
  total: number;
  ac: number;
  hit: boolean;
  critical: boolean;
  /** Rolled with advantage or disadvantage. */
  advantage?: "advantage" | "disadvantage";
  /** Taken as they went past (a reaction). */
  opportunity?: boolean;
  /** A hit turned aside (Sallow's parry). */
  parried?: boolean;
}

/** What a moment did to someone: the damage by type, healing, a save, their hit points after, how they are, a fall, conditions gained and lost, a push. */
export interface FightHit {
  unit: string;
  damage: Array<{ amount: number; type: string }>;
  healed: number;
  /** A saving throw they made against it: saved, or failed. */
  saved?: boolean;
  hp: number;
  maxHp: number;
  state: UnitState;
  /** They went down (or died) in it. */
  fell: boolean;
  gained: string[];
  lost: string[];
  /** Where they were moved to, when it wasn't their own move (a shove). */
  movedTo?: Tile2;
  /** How they stood as the moment began, so a screen can play it from there (a fight's moments seen late are wound back by it). */
  was?: { hp: number; state: UnitState; at: Tile2 };
}

/** A moment's details: what the screen animates, and the log's lines. */
export interface FightEventDetail {
  /** A move's tiles, a step at a time, from the first step to where they stopped (not where they stood). */
  path?: Tile2[];
  /** Where the actor stood as it began. */
  from?: Tile2;
  /** Who or what it was aimed at: a unit's or a prop's id. */
  target?: string;
  /** The target's tile, or where an area was aimed. */
  at?: Tile2;
  /** The weapon's or the spell's name. */
  with?: string;
  /** The spell's id. */
  spell?: string;
  /** A spell's damage type (a bolt's colour). */
  element?: string;
  /** An area spell's tiles. */
  area?: Tile2[];
  rolls: FightRoll[];
  hits: FightHit[];
  /** The log's lines for it: the dice lines and the narration, as the prototype's log had them. */
  lines: string[];
  /** The start's initiative rolls, in the order they'll go. */
  initiative?: Array<{ unit: string; d20: number; modifier: number; total: number }>;
  /** The end's. */
  outcome?: FightOutcome;
  summary?: string;
}

/** One moment, as fight_event has it: its number in the fight, the round and whose turn, its kind, who did it, the caption and the details. */
export interface FightEvent {
  seq: number;
  round: number;
  /** Whose turn it happened on (a unit id; "" before the first). */
  turn: string;
  kind: FightEventKind;
  actor?: string;
  target?: string;
  /** One line in the house style: "The talking Crake steps in and swings: 7 damage." */
  caption: string;
  detail: FightEventDetail;
}

// ---------------------------------------------------------------------------------------------
// The player's turn.

/**
 * One of the player's options, by its action id (the map's: attack@x,y, cast_<spell>@x,y, walk@x,y;
 * the fight's own: dash, end_turn…), with what the screen's menu and aiming show of it: what it's
 * called (one menu line for each name, its targets aimed on the board), what it spends of the turn,
 * where it's aimed and at whom, how far it reaches, and an area's tiles.
 */
export interface FightAction {
  id: string;
  label: string;
  kind: "move" | "attack" | "cast" | "turn";
  /** What it is, for the menu's line: "Attack", "Fire Bolt", "Shove", "Grab", "Dash"; a named move's own words ("Close in on a grey wolf"). */
  name?: string;
  /** What it spends of the turn: the action, the bonus action, movement, or nothing. */
  cost?: "action" | "bonus" | "move" | "free";
  /** The tile it's aimed at (the target's), or walked to. */
  at?: Tile2;
  /** Who or what is there: a unit's or a prop's id. */
  target?: string;
  /** How far it reaches from where they stand, in feet: a weapon's reach (or a bow's long range), a spell's range. */
  range?: number;
  /** The tiles an area would cover, aimed here. */
  area?: Tile2[];
  /** The feet a move takes. */
  feet?: number;
}

/** What the player can do on their turn, as the fight row carries it (none while it isn't theirs). */
export interface FightOptions {
  movementLeft: number;
  /** Their full movement this turn (their speed, doubled once they've dashed), for the screen's gauge. */
  speed?: number;
  actionUsed: boolean;
  bonusActionUsed: boolean;
  /** The tiles they can end a move on this turn. */
  moves: Tile2[];
  /** Of those, the ones a walk to would draw a swing on the way (leaving someone's reach, not having disengaged). */
  swings?: Tile2[];
  actions: FightAction[];
}

/**
 * The fight's own acts, beside the map's moves (fight_turn's `act`). `hurry` is the screen's "skip
 * to your turn": the other side's turns still to come before the player's are played at once.
 */
export const FIGHT_ACTS = ["dash", "dodge", "disengage", "end_turn", "yield", "leave", "auto", "hurry"] as const;
export type FightAct = (typeof FIGHT_ACTS)[number];
export const isFightAct = (id: string): id is FightAct => (FIGHT_ACTS as readonly string[]).includes(id);

/** How a fight ended, for the story (the prototype's CombatResult): the outcome, a summary, everyone's fate, the rounds, where everyone ended up. */
export interface FightResult {
  outcome: FightOutcome;
  /** How it went, for the story (the GM's aftermath): "The player was knocked out." */
  summary: string;
  /** The same told to the player, on their screen and headless: "You were knocked out." (Older rows have none: the summary then.) */
  told?: string;
  casualties: Array<{ id: string; name: string; state: UnitState | "standing" }>;
  rounds: number;
  flags: Record<string, string | number | boolean>;
  positions: Record<string, Tile2>;
}
