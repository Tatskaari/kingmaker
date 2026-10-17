/**
 * The rules code the simulation, the AI service and the client call (v1-design §2.3, §3.6): the
 * prototype's creation, sheet, check and builds code, handed the engine by its host, so one copy runs
 * in both hosts. Nothing here imports the engine or its shim at run time, so the client may load it
 * for the functions that take no engine (sheetText, cardText, picksOf). The pin the simulation runs
 * the engine under is pin.ts's withEngine, which loads the shim: the hosts import it from there.
 */

export type * from "./types.ts";

export { loaded, rulesFrom } from "./engine.ts";
export {
  BUILD_FIELDS, BUILD_GUIDE, BUILD_SCHEMA, buildMenu, carryGear, comeTo, createCharacter, pocketsOf, rollFor, settleBuild, sheetData, sheetRows, sheetText, srdId, styleFor,
} from "./character.ts";

export { cardOf, cardText, classDefault, classesFor, defaultBuilds, ownBuild, picksOf, srdLists, throughEngine } from "./builds.ts";
