import type { Build, BuildCard, BuildOption, OwnPicks, Rules, SheetData, SrdLists } from "./types.ts";

/**
 * The rules code the simulation, the AI service and the client call (v1-design §2.3, §3.6): the
 * prototype's creation, sheet, check and builds code, handed the engine by its host, so one copy runs
 * in both hosts. Nothing here imports the engine or its shim at run time, so the client may load it
 * for the functions that take no engine (sheetText, cardText, picksOf). The pin the simulation runs
 * the engine under is pin.ts's withEngine, which loads the shim: the hosts import it from there.
 */

export type * from "./types.ts";

const notBuilt = (name: string): never => {
  throw new Error(`shared/rules ${name}: not built`);
};

export { loaded, rulesFrom } from "./engine.ts";
export {
  BUILD_FIELDS, BUILD_GUIDE, BUILD_SCHEMA, buildMenu, carryGear, comeTo, createCharacter, pocketsOf, rollFor, settleBuild, sheetData, sheetRows, sheetText, srdId, styleFor,
} from "./character.ts";

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
