// BUILD_FIELDS, BUILD_SCHEMA and BUILD_GUIDE copied from the prototype's src/rules/dnd.ts:274-287 at 44c6d4a, unchanged; the rest is v1-design §3.6's signatures, each a stub until package R builds it.
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { RollResult } from "../dice.ts";
import type { Skill } from "../scene/types.ts";
import type { Build, BuildCard, BuildOption, OwnPicks, Pockets, Rules, RulesSession, SheetData, SheetRows, SrdFile, SrdLists } from "./types.ts";

/**
 * The rules code the simulation, the AI service and the client call, by its signatures (v1-design
 * §2.3, §3.6): the prototype's creation, sheet, check and builds code, handed the engine by its host,
 * so one copy runs in both hosts. Package R replaces each stub here with a re-export of its body
 * (engine.ts, character.ts, builds.ts, spells.ts); until then each throws "not built", and the types
 * (types.ts) are the contract. Nothing here imports the engine at run time.
 */

export type * from "./types.ts";

const notBuilt = (name: string): never => {
  throw new Error(`shared/rules ${name}: not built`);
};

// ---------------------------------------------------------------------------------------------
// engine.ts: the engine, cached per isolate, and the pin each call runs under.

/** The Rules a host hands the rules code, from what it loaded after the shim: the bundle, the pack, the SRD's spells. Once per isolate. */
export function rulesFrom(E: typeof Dnd, pack: unknown, srd: SrdFile): Rules {
  return notBuilt("rulesFrom");
}

/** Runs fn with the engine's ids drawn from rng(seed) and its clock at nowMs (shim.ts pinned); restores both after. */
export function withEngine<T>(pin: { seed: number; nowMs: number }, fn: () => T): T {
  return notBuilt("withEngine");
}

/** The campaign loaded from its exact string, cached per isolate (64, least recently used); never mutated. */
export function loaded(rules: Rules, serialized: string): Dnd.Campaign {
  return notBuilt("loaded");
}

// ---------------------------------------------------------------------------------------------
// character.ts (src/rules/dnd.ts): making the character, its sheet, and what the dice do to it.

/**
 * The player's character, made by the engine from a build (level 1, its choices, levelled up to
 * `level`, the kit equipped; hit points are the average, so no die is drawn): session.rules, and the
 * modifiers and build line on session.player. The prototype's line: "Tamsin Vell: halfling rogue 3
 * (Thief), criminal background. AC 14, HP 24/24."
 */
export function createCharacter(rules: Rules, session: RulesSession, level: number, build: Build): string {
  return notBuilt("createCharacter");
}

/** The sheet row's columns the engine makes, from the session's character as it is now. */
export function sheetRows(rules: Rules, session: RulesSession): SheetRows {
  return notBuilt("sheetRows");
}

/** The whole sheet as data, its purse and pockets too; undefined without a character. */
export function sheetData(rules: Rules, session: RulesSession): SheetData | undefined {
  return notBuilt("sheetData");
}

/** What they carry that isn't gear, from the session's world (or what they carried out of the last); before the story begins, the campaign's starting purse. No engine. */
export function pocketsOf(session: RulesSession, startingPurse: ReadonlyArray<{ name: string; quantity: number }>): Pockets {
  return notBuilt("pocketsOf");
}

/** The sheet as the QA console prints it (the prototype's sheetText lines), from its data with the pockets laid over it. No engine. */
export function sheetText(sheet: SheetData): string {
  return notBuilt("sheetText");
}

/** A skill check through the engine on the cached campaign (conditions, expertise and the like apply): the roll, with session.rollCount one more and the campaign committed. */
export function rollFor(rules: Rules, session: RulesSession, skill: Skill, dc: number): RollResult {
  return notBuilt("rollFor");
}

/** At an opening: someone dropped comes to with 1 HP, prone and unconscious over; its dice line, or undefined for someone who wasn't down. One roll's draw either way. */
export function comeTo(rules: Rules, session: RulesSession): string | undefined {
  return notBuilt("comeTo");
}

/** The story parted them from a piece of gear (an engine item instance), or gave it back: its dice line ("You no longer have your dagger (AC now 12)"), or undefined when nothing changed. */
export function carryGear(rules: Rules, session: RulesSession, instanceId: string, carried: boolean): string | undefined {
  return notBuilt("carryGear");
}

/** A legal build from whatever was suggested: ids as the lists have them, unknown ones the class's defaults. */
export function settleBuild(raw: Partial<Build>, level: number, content: Dnd.Content): Build {
  return notBuilt("settleBuild");
}

/** The Fighting Style that fits how a build fights, where its class has one. */
export function styleFor(build: Build, content: Dnd.Content): string | undefined {
  return notBuilt("styleFor");
}

/** What a model choosing a build may choose from, for a level: the SRD's ids, as the prompt lists them. */
export function buildMenu(level: number, content: Dnd.Content): string {
  return notBuilt("buildMenu");
}

/** An id as the SRD's lists have it, however a model wrote it ("Cleric", "Life Domain", "hunter's mark"). */
export function srdId(s: string): string {
  return notBuilt("srdId");
}

/** A build's fields as a JSON schema's properties (the model's answer, before settleBuild makes it legal). */
export const BUILD_FIELDS = ["classId", "subclassId", "speciesId", "backgroundId", "abilities", "skills", "feat", "cantrips", "spells", "weapons", "armor", "shield", "style"] as const;
export const BUILD_SCHEMA: Record<string, unknown> = {
  classId: { type: "string" }, subclassId: { type: "string" }, speciesId: { type: "string" }, backgroundId: { type: "string" },
  abilities: { type: "array", items: { type: "string" }, description: "All six abilities, most important first" },
  skills: { type: "array", items: { type: "string" }, description: "Skills they'd be trained in, most characteristic first (up to 6)" },
  feat: { type: "string", description: "One origin feat" },
  cantrips: { type: "array", items: { type: "string" } }, spells: { type: "array", items: { type: "string" } },
  weapons: { type: "array", items: { type: "string" }, description: "One to three weapons, main weapon first" },
  armor: { type: "string" }, shield: { type: "boolean" },
  style: { type: "string", description: "A fighter's, paladin's or ranger's Fighting Style, to fit how they fight: archery, defense, dueling, great-weapon, protection or two-weapon (a paladin has no archery or two-weapon, a ranger no great-weapon or protection). Anyone else: none" },
};

/** How a build is chosen for a concept: what fits who they are, not what's strongest, from the lists' ids. */
export const BUILD_GUIDE = `Choose what fits who they are and how they'd go about things, not what's strongest: a palace inspector might be a rogue (Investigation, Insight), a hedge witch a druid, a brawling ex-soldier a fighter, a silver-tongued con artist a bard. Use only ids from the lists. Spells must be on the class's list (ids marked with the class): give cantrips and levelled spells that suit the concept, including some useful outside a fight. Weapons and armour are what they'd carry; armour "none" if they wouldn't wear any.`;

// ---------------------------------------------------------------------------------------------
// builds.ts (src/rules/builds.ts, without the model): the class defaults, a build through the engine, the player's own.

/** The classes in order of how well the concept's words suggest them (the fallback order breaks ties). */
export function classesFor(concept: string): string[] {
  return notBuilt("classesFor");
}

/** A class's default build, with what the concept names (a species, a background) in place of its own, and how it plays. */
export function classDefault(classId: string, concept?: string): { build: Build; plays: string } {
  return notBuilt("classDefault");
}

/** Offline: three builds from the class defaults that best match the concept's words, each a different class. */
export function defaultBuilds(concept: string): Array<{ build: Build; plays: string }> {
  return notBuilt("defaultBuilds");
}

/** A build made legal and made by the engine as character creation would make it: the build, its line and its card. */
export function throughEngine(rules: Rules, raw: Partial<Build>, level: number, name?: string): { build: Build; line: string; card: BuildCard } {
  return notBuilt("throughEngine");
}

/** What the player picks from to make their own: the SRD's species, classes, subclasses and backgrounds, each with a line about it. */
export function srdLists(rules: Rules, level: number): SrdLists {
  return notBuilt("srdLists");
}

/** The player's own build, the rest the class's defaults, made legal by the engine; an id not on the SRD's lists throws, saying what is. */
export function ownBuild(rules: Rules, picks: OwnPicks, level: number, name?: string): BuildOption {
  return notBuilt("ownBuild");
}

/** What a sheet says of a build, for its card. No engine. */
export function cardOf(sheet: SheetData, build: Build): BuildCard {
  return notBuilt("cardOf");
}

/** A build's card as plain text (the QA console's): who, how they'd play, the numbers. No engine. */
export function cardText(option: BuildOption): string {
  return notBuilt("cardText");
}

/** The picks a build was made from (to start the player's own from the one they were looking at). No engine. */
export function picksOf(build: Build): OwnPicks {
  return notBuilt("picksOf");
}
