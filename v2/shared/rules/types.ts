// Copied from the prototype at 44c6d4a: Build (src/rules/dnd.ts:218-225), Uses and SheetData (:635-695), BuildCard, BuildOption and Offer (src/rules/builds.ts:15-51), Choice, SrdLists and OwnPicks (:300-336), SrdBlock, SrdSpell, SrdFile and SpellDetails (src/rules/spells.ts:15-20, 64-91), RulesState (src/runtime/session.ts:47-73); the world bridge's (world-bridge-design §3.2): Mechanic, Jumping and ActFrom (src/runtime/director.ts:409-430), Reaction and Act (:1136-1139), ThreatRead (:1230), Threat (src/runtime/session.ts:74-77), Brawl (the type of session.ts:306-311's brawl, named), SpellFacts (src/game/scene-menu.ts:54-59), as they are; SrdFile exported, gear's slot and kind widened to the row's strings; the rest is v2's.
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { Backstory } from "../creation/types.ts";
import type { GmState } from "../gm/state.ts";
import type { Skill } from "../scene/types.ts";
import type { Entity, SceneWorld } from "../world/scene-world.ts";

/**
 * The rules engine's types, as the simulation, the AI service and the client share them (v1-design
 * §3.6). shared/rules runs the prototype's rules code on an engine its host hands it (Rules), and
 * imports the engine's typings as types only: the simulation loads the bundle in the module, the AI
 * service in Node, and the client never does (it reads what the engine made from the rows).
 */

// ---------------------------------------------------------------------------------------------
// The engine, as a host hands it over.

/** The engine and its content, loaded once per isolate by the host (simulation/src/rules/load.ts, ai/rules/load.ts) after the shim. */
export interface Rules {
  /** The bundle: vendor/dnd-srd-engine/dnd-srd-engine.module.js. */
  E: typeof Dnd;
  /** The starter pack (starter-pack.json), already validated. */
  pack: unknown;
  /** The SRD's spell texts (vendor/srd-spells/spells.json). */
  srd: SrdFile;
  /** The pack's content, from an engine made once to read it. */
  content: Dnd.Content;
  /** The isolate's engine, its generator reseeded for this use: it rolls as createEngine({ rng: seededRNG(seed) }) does. */
  engine(seed: number): Dnd.Engine;
}

/**
 * What the rules code reads of a game: the subset of the prototype's SessionState it touches, under
 * the same names, so the copied bodies read it unchanged. The simulation builds one from the rows
 * (dice, player, sheet, rules_state, and the place's world when there is one), and writes back what
 * changed: rollCount (dice.rolls), rules (rules_state's campaign, gone, npcs, timed and rage), and the
 * sheet.
 */
export interface RulesSession {
  /** The game's uid (the engine's campaign is named after it). */
  id: string;
  /** dice.seed. */
  seed: number;
  /** dice.rolls: a check through the engine adds one. */
  rollCount: number;
  /**
   * The scene's turn (its n) while the rules act in one, as the copied code reads the prototype's
   * state.turn: what the world's notes and log are stamped with, and when a hold caught the player.
   * 0 outside a scene (creation, a sheet, the pockets).
   */
  turn: number;
  player: { name: string; concept: string; modifiers: Partial<Record<Skill, number>>; build?: string; backstory?: Backstory };
  /** The engine's character, once it's made. */
  rules?: RulesState;
  /** The world the player is in, when they're in one: their purse and pockets are read from it. */
  world?: SceneWorld;
  /** What they carried out of the last scene's world (V3). */
  carried?: Entity[];
  /** Scenes played before this one (V3): only whether there are any is read (a purse before the story begins). */
  history?: readonly unknown[];
  /** A blow or a danger the last reply left hanging over the player (gm_state.threat): it lands as their next turn starts (threats.ts landThreat), which takes it off. */
  threat?: Threat;
  /** The turn a hold caught the player (gm_state.held): it stands with no more saving throws until they break free or the story lets them go. */
  held?: number;
}

/**
 * A rules session in a scene (world-bridge-design §2.1): the RulesSession with the GM's bookkeeping
 * that the copied scene acts read and write under the prototype's names. presentCast reads beat,
 * path, entered and absent; react writes absent (the cast who fled), brawl and threat; a hold writes
 * held. The simulation builds one from the rows and the scene's gm_state, and writes those back.
 */
export type SceneSession = RulesSession & Pick<GmState, "beat" | "path" | "entered" | "absent" | "brawl">;

/** The engine's side of a character: its campaign (the event log), and what the rules keep ready from it. */
export interface RulesState {
  /** The engine campaign, event log and state (serializeCampaign). */
  campaign: string;
  /** Engine id of the player character. */
  pc: string;
  /** Story characters the rules have touched: cast id -> engine id and the weapon they fight with. */
  npcs: Record<string, { id: string; weapon: string }>;
  /** Cast id -> what the player calls them, for people whose names they haven't heard (the dice name them so). */
  aliases?: Record<string, string>;
  /** The build's preferences, in order, for choices that come later (level-ups). */
  prefer?: string[];
  /** Kept up to date by the rules, so a turn's decision needn't load the engine. */
  spells?: SpellRef[];
  weapons?: WeaponRef[];
  /** Class features the player can use in a scene (Second Wind, Rage...), with whether they take a target. */
  features?: Array<{ id: string; name: string; target: "self" | "creature" }>;
  /** "HP 13/24, spell slots 1st 2/4": the player's state for the GM's brief. */
  status?: string;
  /** A spell with a listed duration is running: story time passing can end it. */
  timed?: boolean;
  /** A barbarian's Rage: the minutes of story time it has left. */
  rage?: number;
  /** The player's gear (engine item instances), mirrored into scene worlds as things they carry. */
  gear?: GearRow[];
  /** Gear the story has parted them from (given away, dropped, left behind): off the sheet until they get it back. */
  gone?: string[];
}

// ---------------------------------------------------------------------------------------------
// The rows' parts: each the TypeScript side of an object column in simulation/src/schema.ts.

/** A piece of the player's gear: an engine item instance (rules_state.gear). kind: weapon, armor, shield, item; slot: mainHand, offHand, armor, shield. */
export interface GearRow { id: string; name: string; kind: string; slot?: string }
/** A spell slot level: how many, and how many spent (sheet.slots). */
export interface SlotRow { level: number; max: number; used: number }
/** A spell ready to cast: cantrips and prepared spells (sheet.spells). */
export interface SpellRef { id: string; name: string; level: number }
/** A weapon they carry, by its engine item instance (sheet.weapons). */
export interface WeaponRef { id: string; name: string }
/** A class feature with uses they can use in a scene; target: self or creature (sheet.features). */
export interface FeatureRef { id: string; name: string; target: string }

/**
 * The sheet row's columns the engine makes (sheetRows): everything but its keys and `pockets`. JSON
 * columns are JSON here too, so they go into the row as they are: { playerId, gameId, ...sheetRows(…), pockets }.
 */
export interface SheetRows {
  /** "elf ranger 3 (Hunter), soldier background" (buildLine). */
  build: string;
  /** JSON: Record<Skill, number>, all 18 (modifiersFrom). */
  skills: string;
  /** "HP 28/28, spell slots 1st 3/3" (status). */
  statusLine: string;
  level: number;
  hp: number;
  maxHp: number;
  ac: number;
  slots: SlotRow[];
  conditions: string[];
  spells: SpellRef[];
  weapons: WeaponRef[];
  features: FeatureRef[];
  /** JSON: SheetData without purse and carrying (Pockets has those). */
  data: string;
  /** JSON: the player's Backstory, when they have one (an option column: undefined, not absent). */
  backstory: string | undefined;
  /**
   * JSON: SpellFacts[], what the rules say of each spell in `spells` (its range, its effects' kinds,
   * whether it fills an area): where the scene's menu offers it (world-bridge-design §3.3). "" while
   * nothing has worked them out: the menu then offers every spell anywhere, by its name.
   */
  spellFacts: string;
  /**
   * JSON: shared/rules/aim.ts Catalogue, the map's action menu (town-design §3.3): what they can do
   * outside a fight, by kind, and why not where they can't, made with the explorer's rest at this time
   * of day (RulesSession's). "" before the menu: the client offers none.
   */
  actions: string;
}

/** What they carry that isn't gear: the coins in their purse, and anything else on them (sheet.pockets, as JSON). */
export interface Pockets {
  purse: Array<{ name: string; quantity: number }>;
  /** Anything else on them in the story's world (a letter, a key), and what it's in. */
  carrying: Array<{ name: string; quantity: number; in?: string }>;
}

// ---------------------------------------------------------------------------------------------
// The world bridge (world-bridge-design §3.2): what the rules resolve in a scene, how people take it,
// and what it leaves hanging over the player.

/** What the player is doing that the D&D rules resolve, and with what. */
export type Mechanic =
  /** unclear: aimed at a thing, but at which wasn't clear (the rules ask, rather than hit the wrong one). */
  | { kind: "cast"; spell: string; targets: string[]; from?: ActFrom; unclear?: boolean }
  | { kind: "wrestle"; target: string; how: "grapple" | "prone" | "push"; from?: ActFrom }
  | { kind: "attack"; target: string; weapon?: string; from?: ActFrom }
  | { kind: "rest"; length: "short" | "long" }
  | { kind: "feature"; feature: string; target?: string }
  | Jumping;

/**
 * A jump (the same rule in a scene, on the map and in a fight): where to (an area, or by
 * something), over what if they fall short, and how far, from the world when it knows.
 */
export interface Jumping { kind: "jump"; how: "long" | "high" | "down"; runUp: boolean; to?: ActFrom; over?: string; water?: boolean; feet?: number; drop: number }

/**
 * Where the player acts from, when they move first in the same turn ("I stride thirty feet down
 * the lane and cast Fireball at the elm"): the world moves them there before the rules roll, or
 * the spell goes off from where they were.
 */
export interface ActFrom { area?: string; near?: string; backOff?: number }

/** How someone takes the player's violence, in the moment. */
export type Reaction = "fight" | "flee" | "raise_alarm" | "cower" | "intervene" | "join_player" | "unmoved";

/** What the player did that people react to: who it hurt or caught, what it burned or broke. */
export interface Act { what: string; victims: string[]; property: string[] }

/** What the read after a reply found hanging over the player: someone's blow, or a danger they save against (the hazard's kind is one of acts.ts's HAZARD_KINDS). */
export type ThreatRead = { kind: "attack"; by: string } | { kind: "hazard"; hazard: string; severity: "glancing" | "serious" };

/** Something the last reply left hanging over the player, resolved by the rules at the start of their next turn. */
export type Threat =
  | { kind: "attack"; by: string; turn: number }
  | { kind: "hazard"; hazard: string; severity: "glancing" | "serious"; turn: number };

/**
 * A fight the player's violence started in the scene (decided reactions: some fight, some flee):
 * who goes for the player and who's with them. The game plays it out on the map; elsewhere the
 * first of them swings at the player next turn.
 */
export interface Brawl { turn: number; cause: string; against: string[]; allies: string[]; fled: string[] }

/**
 * One of the player's spells, with what the rules say of its reach when that's known: its range
 * ("Self", "Touch", "120 feet", "Self (15-foot cone)"), its effects' kinds (attack, save, heal,
 * buff...), and whether it fills an area.
 */
export interface SpellFacts { id: string; name: string; level: number; range?: string; effects?: string[]; area?: boolean }

// ---------------------------------------------------------------------------------------------
// Builds.

export interface Build {
  classId: string; subclassId: string; speciesId: string; backgroundId: string;
  /** Most to least important: the standard array (15, 14, 13, 12, 10, 8) is assigned in this order. */
  abilities: string[];
  skills: string[]; feat: string; cantrips: string[]; spells: string[]; weapons: string[]; armor: string; shield: boolean;
  /** A fighter's, paladin's or ranger's Fighting Style, by the choice's option id ("dueling"); without one, the engine's first. */
  style?: string;
}

/** What a build comes to, as the engine makes it: the numbers a card shows. */
export interface BuildCard {
  species: string;
  className: string;
  /** Where the level has one (2024: from level 3). */
  subclass?: string;
  background: string;
  level: number;
  hp: number;
  ac: number;
  speed: number;
  /** The weapon in hand (or the first they carry): what they'd hit someone with. */
  attack?: { name: string; bonus: number; damage: string; type: string };
  /** A caster's: the save DC and spell attack, the cantrips and the levelled spells ready. */
  casting?: { ability: string; saveDC: number; attackBonus: number; cantrips: string[]; spells: string[] };
  /** The class features worth naming on a card (Sneak Attack, Rage, Second Wind), with their uses. */
  features: string[];
  /** Trained skills, the build's most characteristic first. */
  skills: string[];
}

export interface BuildOption {
  /** Legal already (settleBuild's): character creation makes exactly this. */
  build: Build;
  /** How they'd play, in a sentence. */
  plays: string;
  card: BuildCard;
  /** The build in a line, as the GM's brief has it ("halfling rogue 3 (Thief), criminal background"). */
  line: string;
  /** The model's, the class defaults' (offline, or to fill in), or the player's own. */
  from: "model" | "defaults" | "own";
}

export interface Offer {
  options: BuildOption[];
  /** Why they're the class defaults rather than the model's: the GM is offline, or couldn't be reached. */
  note?: string;
}

export interface Choice { id: string; name: string; about: string }
export interface SrdLists {
  species: Choice[];
  classes: Choice[];
  /** Each class's subclasses (the SRD has one each), for a level that has one. */
  subclasses: Record<string, Choice[]>;
  backgrounds: Choice[];
  /** The level they're made at: below a class's subclass level there's none to choose. */
  level: number;
  subclassLevel: Record<string, number>;
}

export interface OwnPicks { speciesId: string; classId: string; subclassId?: string; backgroundId: string }

// ---------------------------------------------------------------------------------------------
// The sheet.

/** Uses of a feature (the engine's class resources): Second Wind 2/2, back on a short rest. */
export interface Uses {
  current: number;
  max: number;
  /** "short rest", "long rest", "one back per short rest" (Channel Divinity). */
  recharge?: string;
}

/**
 * The character sheet as data, for a laid-out sheet (client/ui/sheet-layout.ts): everything
 * sheetText says, in fields, and what it leaves out (save proficiencies, features and their uses,
 * spell slots spent, what they carry and their purse).
 */
export interface SheetData {
  name: string;
  concept: string;
  species: string;
  background: string;
  classes: Array<{ id: string; name: string; level: number; subclass?: string }>;
  level: number;
  hp: { current: number; max: number; temp: number };
  ac: number;
  /** In feet: walk, and climb or swim if they have them. */
  speeds: Record<string, number>;
  initiative: number;
  proficiency: number;
  hitDice: Array<{ die: number; left: number; total: number }>;
  inspiration: boolean;
  /** Only while they're down. */
  deathSaves?: { successes: number; failures: number; stable: boolean };
  abilities: Array<{ id: Dnd.Ability; name: string; score: number; modifier: number; save: number; proficient: boolean }>;
  skills: Array<{ id: string; name: string; ability: Dnd.Ability; modifier: number; proficiency: string; advantage: boolean; disadvantage: boolean }>;
  /** Passive Perception, Insight and Investigation. */
  passive: Record<string, number>;
  attacks: Array<{ name: string; kind: string; bonus: number; damage: string; type: string; versatile?: string; range?: { normal: number; long: number }; properties: string[]; mastery?: string; held: boolean }>;
  spellcasting?: {
    className: string; ability: Dnd.Ability; saveDC: number; attackBonus: number;
    slots: Array<{ level: number; max: number; used: number }>;
    /** A warlock's: all of one level, back on a short rest. */
    pact?: { level: number; max: number; used: number };
    /** Each with its details, for when it's picked on the sheet: the card, the game's terms at their numbers, the SRD's words (shared/rules/spells.ts). */
    spells: Array<{ level: number; spells: Array<{ id: string; name: string; ready: boolean; always: boolean; concentration: boolean; ritual: boolean; details?: SpellDetails }> }>;
  };
  /** Class and subclass features to their level, with what was chosen for them and their uses. */
  features: Array<{ name: string; from: string; level: number; choice?: string; uses?: Uses }>;
  feats: string[];
  /** The species' gifts: darkvision, resistances, a lineage. */
  traits: string[];
  conditions: string[];
  equipment: Array<{ name: string; kind: string; slot?: "in hand" | "off hand" | "worn"; quantity: number }>;
  /** Anything else on them in the story's world (a letter, a key), and what it's in. */
  carrying: Array<{ name: string; quantity: number; in?: string }>;
  purse: Array<{ name: string; quantity: number }>;
  languages: string[];
  proficiencies: { armor: string[]; weapons: string[]; tools: string[] };
  /** Their backstory from character creation, and what it says of them (personality, ideals, bonds, flaws). */
  story?: { backstory: string; personality: string[]; ideals: string[]; bonds: string[]; flaws: string[] };
}

// ---------------------------------------------------------------------------------------------
// Spells, as the sheet shows one when it's picked.

/** A block of the SRD's description: a paragraph, a list item, a heading in a stat block, or a table. Emphasis as _italic_ and **bold**. */
export type SrdBlock = string | { item: string } | { heading: string } | { table: string[][]; head?: boolean; caption?: string };

/** A spell as the SRD prints it: its header lines and its description. */
export interface SrdSpell { name: string; castingTime: string; range: string; components: string; duration: string; text: SrdBlock[] }

/** vendor/srd-spells/spells.json: every spell's words by the engine's spell id, and the attribution the SRD asks for. */
export interface SrdFile { attribution: string; license: string; spells: Record<string, SrdSpell> }

/** A spell on the sheet, picked. */
export interface SpellDetails {
  id: string;
  name: string;
  level: number;
  school: string;
  /** The SRD's line for it: "Level 3 Evocation (Sorcerer, Wizard)", "Evocation Cantrip (Sorcerer, Wizard)". */
  levelLine: string;
  /** The engine's casting time, with a reaction's or bonus action's trigger where the SRD gives one. */
  castingTime: string;
  /** The SRD's, where the game's is another (Barkskin: the game's an Action, the SRD's a Bonus Action). */
  srdCastingTime?: string;
  range: string;
  components: { verbal: boolean; somatic: boolean; material?: string };
  duration: string;
  concentration: boolean;
  ritual: boolean;
  /** What it does in this game's terms, a line each: the attack or save and what comes of it. Empty when the rules roll nothing for it. */
  does: string[];
  /** The area it fills: "a 20-foot-radius sphere". */
  area?: string;
  /** How it grows: a cantrip with the caster's level, a spell with a higher slot (or nothing more, where the SRD's grows and the game's doesn't). */
  scaling: string[];
  /** Whether a fight on the map offers it (inFights). */
  inFights: boolean;
  /** The SRD's description, in its own words; undefined when there isn't one. */
  text?: SrdBlock[];
  /** With the SRD's words, its attribution statement, as it asks for it wherever they're used. */
  credit?: string;
}
