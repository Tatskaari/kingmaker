// New (M4): docs/scenario-format.md's contract as TypeScript (the .kmscenario, .kmmap and .kmplace files, version 2), their parses, and the game's own shapes made from them.
import type { CreationWorld } from "../creation/types.ts";
import type { LegendEntry, MapFile, MapPerson, PlaceRegion } from "../map/tiles.ts";
import type { TileMap } from "../map/types.ts";
import type { Material, Size, ThingSpec, WorldSpec } from "../world/scene-world.ts";
import type { CampaignFile, PlaceFile, TimeOfDay } from "./files.ts";

/**
 * The scenario, its maps and its places are files the game loads as they are and the Obsidian plugin
 * edits as they are (docs/scenario-format.md), beside the scenes (document.ts). Each has the scenes'
 * envelope (format, version 2, kind, id, title, description) over the fields the game had in
 * campaign.json, maps/<key>.json and places/<key>.json:
 *   <campaign>.kmscenario       the campaign: its start, its scenes, places and maps, the purse, the quests
 *   maps/<key>.kmmap            a map: its grid, legend, regions, exits and who's about
 *   places/<key>.kmplace        a scene's place: its areas, things and where people start
 * Unknown keys are kept: a parse checks the shape the game reads and returns the object as it was.
 * The game plays on the shapes it always had (files.ts's CampaignFile and PlaceFile, tiles.ts's
 * MapFile): asCampaignFile, asMapFile and asPlaceFile make them, each the old file's fields in its
 * order, so what's installed and kept in the rows is as it was.
 */

export const SCENARIO_EXTENSION = ".kmscenario";
export const MAP_EXTENSION = ".kmmap";
export const PLACE_EXTENSION = ".kmplace";

/** Where a campaign keeps its scenario: <id>.kmscenario, at the folder's root. */
export const scenarioPath = (id: string) => `${id}${SCENARIO_EXTENSION}`;
/** Where a campaign keeps a map: maps/<key>.kmmap. */
export const mapPath = (key: string) => `maps/${key}${MAP_EXTENSION}`;
/** Where a campaign keeps a place: places/<key>.kmplace. */
export const placePath = (key: string) => `places/${key}${PLACE_EXTENSION}`;

/** A campaign folder's scenario among its files' paths: its one .kmscenario at the root, if it has exactly one. */
export function scenarioPathIn(paths: Iterable<string>): string | undefined {
  const found = [...paths].filter(path => !path.includes("/") && path.endsWith(SCENARIO_EXTENSION));
  return found.length === 1 ? found[0] : undefined;
}

/** What every file of the format starts with (a scene's too). */
interface Envelope<K extends string> {
  format: "kingmaker";
  version: 2;
  kind: K;
  id: string;
  title: string;
  description: string;
}

/** The campaign (<id>.kmscenario): campaign.json's fields under the envelope. */
export interface ScenarioDocument extends Envelope<"scenario"> {
  /** The campaign's own version ("0.1.0"); the envelope's `version` is the format's. A game is installed as <id>@<campaignVersion>. */
  campaignVersion: string;
  firstScene: string;
  startPlace: string;
  /** When the story starts, and where the player starts walking: a map and a tile on it (the plugin's spawn point). */
  start: { day: number; time: TimeOfDay; map?: string; at?: [number, number] };
  level: number;
  rulesPack: string;
  /** The story's scenes in order (scenes/<id>.kmscene), and the talk template. */
  scenes: string[];
  talk?: string;
  /** Its places (places/<key>.kmplace) and maps (maps/<key>.kmmap). */
  places: string[];
  maps: string[];
  startingPurse: Array<{ name: string; quantity: number; description: string }>;
  creation: CreationWorld;
  quests?: Record<string, string>;
  /** Where each scene and map sits on the scenario's diagram (the plugin's layout, nothing the game reads). */
  layout?: Record<string, { x: number; y: number }>;
}

/** A map (maps/<id>.kmmap): tiles.ts's MapFile under the envelope, its title the map's name. */
export interface MapDocument extends Envelope<"map"> {
  /** Rows of legend characters, north at the top. */
  grid: string[];
  /** Legend character → the tile: terrain, its overrides (style, height, roof, roofHeight, blocks, opaque) and the decor that stands on it. */
  legend: Record<string, LegendEntry>;
  /** Named parts of the map. One with a sceneId and a worldOrigin is where that scene's place is laid; one with a sceneId and a trigger opens it. */
  regions: PlaceRegion[];
  /** Doors and paths to other maps. */
  exits: TileMap["exits"];
  /** Who's about at which hours. */
  people?: MapPerson[];
}

/** A scene's place (places/<key>.kmplace): the world it's played in, in feet. Its id is what a scene's `place` names, its title the place's name. */
export interface PlaceDocument extends Envelope<"place"> {
  size: WorldSpec["size"];
  areas: WorldSpec["areas"];
  /** The things here: what the scenes' clue paths and effects name. */
  things: WorldSpec["things"];
  /** Where people start: cast id (or "player") → area and spot. */
  people: WorldSpec["people"];
}

// ---------------------------------------------------------------------------------------------
// The game's shapes, made from the files.

/**
 * The campaign as the game keeps it (install_campaign's, the campaign row's): the scenario's fields
 * but the envelope's and the plugin's layout, its version the campaign's own. "The loader reads
 * either": a scenario written before the rename, its campaign's version still a string in `version`,
 * is read too (the campaign check asks for campaignVersion).
 */
export function asCampaignFile(doc: ScenarioDocument): CampaignFile {
  const { format: _format, version: _version, kind: _kind, id, title, description: _description, campaignVersion: _campaignVersion, layout: _layout, ...rest } = doc;
  return { id, title, version: campaignVersionOf(doc), ...rest } as CampaignFile;
}

/** A scenario's campaign version: campaignVersion, or a version written before the rename (a string where the format's 2 goes). */
export function campaignVersionOf(doc: Pick<ScenarioDocument, "campaignVersion"> & { version: unknown }): string {
  return typeof doc.campaignVersion === "string" ? doc.campaignVersion : String(doc.version);
}

/** A map as the game builds it (tiles.ts mapOf, the map_def row): its title as its name, the envelope gone. */
export function asMapFile(doc: MapDocument): MapFile {
  const { format: _format, version: _version, kind: _kind, id, title, description: _description, ...rest } = doc;
  return { id, name: title, ...rest } as MapFile;
}

/** A place as the game builds its world (scene-world.ts buildWorld, the place_def row): its id as its key, its title as its name. */
export function asPlaceFile(doc: PlaceDocument): PlaceFile {
  const { format: _format, version: _version, kind: _kind, id, title, ...rest } = doc;
  return { key: id, name: title, ...rest } as PlaceFile;
}

/** A .kmscenario's text as the campaign the game keeps; a FormatError naming `where` when it isn't a scenario. */
export const loadScenario = (text: string, where?: string): CampaignFile => asCampaignFile(parseScenario(text, where));
/** A .kmmap's text as the map the game builds; a FormatError naming `where` when it isn't a map. */
export const loadMap = (text: string, where?: string): MapFile => asMapFile(parseMap(text, where));
/** A .kmplace's text as the place the game builds a world from; a FormatError naming `where` when it isn't a place. */
export const loadPlace = (text: string, where?: string): PlaceFile => asPlaceFile(parsePlace(text, where));

// ---------------------------------------------------------------------------------------------
// The parses: the shape the game reads. What an author is held to beyond it (the ids its files are
// named for, what the scenario lists being there, the legend's terrains, regions and exits that
// lead somewhere real, places that fit their maps…) is scenario-rules.ts's, the campaign check's.

/** A file of the format that doesn't parse: every problem, each naming where it is in the file. */
export class FormatError extends Error {
  readonly where: string;
  readonly problems: string[];
  constructor(where: string, problems: string[]) {
    super(`${where}: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? `; and ${problems.length - 4} more` : ""}`);
    this.name = "FormatError";
    this.where = where;
    this.problems = problems;
  }
}

/** A .kmscenario file's text as a scenario, or a FormatError. */
export const parseScenario = (text: string, where = "the scenario"): ScenarioDocument => scenarioDocumentOf(parsed(text, where), where);
/** A .kmmap file's text as a map, or a FormatError. */
export const parseMap = (text: string, where = "the map"): MapDocument => mapDocumentOf(parsed(text, where), where);
/** A .kmplace file's text as a place, or a FormatError. */
export const parsePlace = (text: string, where = "the place"): PlaceDocument => placeDocumentOf(parsed(text, where), where);

/** A parsed value as a scenario: the same object, once it has the format's shape. */
export function scenarioDocumentOf(value: unknown, where = "the scenario"): ScenarioDocument {
  return held(scenarioShapeProblems(value), value, where) as ScenarioDocument;
}

/** A parsed value as a map: the same object, once it has the format's shape. */
export function mapDocumentOf(value: unknown, where = "the map"): MapDocument {
  return held(mapShapeProblems(value), value, where) as MapDocument;
}

/** A parsed value as a place: the same object, once it has the format's shape. */
export function placeDocumentOf(value: unknown, where = "the place"): PlaceDocument {
  return held(placeShapeProblems(value), value, where) as PlaceDocument;
}

/** What's wrong with a value's shape as a scenario, each problem naming where: [] when it's one. */
export function scenarioShapeProblems(value: unknown): string[] {
  if (!isObject(value)) return ["it isn't a JSON object"];
  const d = value, p: string[] = [];
  // The loader reads either: campaignVersion, or (written before the rename) the campaign's version in `version`.
  const before = d.campaignVersion === undefined && typeof d.version === "string";
  envelopeProblems(d, "scenario", p, before);
  if (!before && !nonEmpty(d.campaignVersion)) p.push("it has no campaignVersion (the campaign's own version, \"0.1.0\": its version is the format's, 2)");
  for (const k of ["firstScene", "startPlace", "rulesPack"]) if (typeof d[k] !== "string") p.push(`it has no ${k}`);
  if (typeof d.level !== "number") p.push("it has no level");
  const start = d.start;
  if (!isObject(start)) p.push("it has no start { day, time, map?, at? }");
  else {
    if (typeof start.day !== "number") p.push("its start has no day");
    if (!TIMES.includes(start.time as TimeOfDay)) p.push(`its start's time ${JSON.stringify(start.time)} isn't one of ${TIMES.join(", ")}`);
    if (start.map !== undefined && typeof start.map !== "string") p.push("its start's map isn't a map's id");
    if (start.at !== undefined && !isPair(start.at)) p.push("its start's at isn't a tile [x, y]");
  }
  for (const k of ["scenes", "places", "maps"]) stringList(d, k, p, "its ");
  if (d.talk !== undefined && typeof d.talk !== "string") p.push("its talk isn't a scene's id");
  const purse = d.startingPurse;
  if (!Array.isArray(purse)) p.push("it has no startingPurse list");
  else purse.forEach((coin, i) => {
    if (!isObject(coin) || typeof coin.name !== "string" || typeof coin.quantity !== "number" || typeof coin.description !== "string") p.push(`startingPurse[${i}] isn't { name, quantity, description }`);
  });
  if (!isObject(d.creation)) p.push("it has no creation { name, premise, primer, notCanon, places }");
  if (d.quests !== undefined && !(isObject(d.quests) && Object.values(d.quests).every(t => typeof t === "string"))) p.push("its quests aren't { key: title }");
  if (d.layout !== undefined && !(isObject(d.layout) && Object.values(d.layout).every(isPoint))) p.push("its layout isn't { id: { x, y } }");
  return p;
}

/** What's wrong with a value's shape as a map, each problem naming where: [] when it's one. */
export function mapShapeProblems(value: unknown): string[] {
  if (!isObject(value)) return ["it isn't a JSON object"];
  const d = value, p: string[] = [];
  envelopeProblems(d, "map", p);
  if (!(Array.isArray(d.grid) && d.grid.length > 0 && d.grid.every(row => typeof row === "string"))) p.push("its grid isn't a list of rows (text, one character a tile)");
  if (!isObject(d.legend)) p.push("it has no legend { character: tile }");
  else for (const [ch, entry] of Object.entries(d.legend)) {
    const at = `legend ${JSON.stringify(ch)}`;
    if ([...ch].length !== 1) p.push(`${at} isn't one character`);
    if (!isObject(entry) || typeof entry.terrain !== "string") { p.push(`${at} has no terrain`); continue; }
    for (const k of ["style", "roof"]) if (entry[k] !== undefined && typeof entry[k] !== "string") p.push(`${at}'s ${k} isn't text`);
    for (const k of ["height", "roofHeight"]) if (entry[k] !== undefined && typeof entry[k] !== "number") p.push(`${at}'s ${k} isn't a number`);
    for (const k of ["blocks", "opaque"]) if (entry[k] !== undefined && typeof entry[k] !== "boolean") p.push(`${at}'s ${k} isn't true or false`);
    const decor = entry.decor;
    if (decor !== undefined && !(isObject(decor) && typeof decor.name === "string" && typeof decor.glyph === "string"
      && ["color", "kind", "text", "id"].every(k => decor[k] === undefined || typeof decor[k] === "string")
      && (decor.blocks === undefined || typeof decor.blocks === "boolean") && (decor.states === undefined || isStrings(decor.states)))) p.push(`${at}'s decor isn't { name, glyph, color?, kind?, blocks?, states?, text?, id? }`);
  }
  const regions = Array.isArray(d.regions) ? d.regions : (p.push("it has no regions list"), []);
  regions.forEach((r, i) => {
    const at = `regions[${i}]${isObject(r) && typeof r.id === "string" ? ` (${r.id})` : ""}`;
    if (!isObject(r)) return p.push(`${at} isn't an object`);
    if (!nonEmpty(r.id)) p.push(`${at} has no id`);
    if (typeof r.name !== "string") p.push(`${at} has no name`);
    if (!isRect(r.rect)) p.push(`${at} has no rect { x, y, w, h }`);
    for (const k of ["sceneId", "description", "label", "shut", "opensFor", "lockedAfter", "exteriorOf", "locked"]) if (r[k] !== undefined && typeof r[k] !== "string") p.push(`${at}'s ${k} isn't text`);
    if (r.trigger !== undefined && r.trigger !== "enter" && r.trigger !== "interact") p.push(`${at}'s trigger ${JSON.stringify(r.trigger)} isn't enter or interact`);
    if (r.worldOrigin !== undefined && !isPoint(r.worldOrigin)) p.push(`${at}'s worldOrigin isn't a tile { x, y }`);
  });
  const exits = Array.isArray(d.exits) ? d.exits : (p.push("it has no exits list"), []);
  exits.forEach((e, i) => {
    const fits = isObject(e) && isPoint(e.at) && isObject(e.to) && nonEmpty(e.to.map) && isPoint(e.to.at) && typeof e.label === "string";
    if (!fits) p.push(`exits[${i}] isn't { at: { x, y }, to: { map, at: { x, y } }, label }`);
  });
  if (d.people !== undefined) {
    if (!Array.isArray(d.people)) p.push("its people aren't a list");
    else d.people.forEach((person, i) => {
      const at = `people[${i}]${isObject(person) && typeof person.name === "string" ? ` (${person.name})` : ""}`;
      if (!isObject(person)) return p.push(`${at} isn't an object`);
      for (const k of ["name", "glyph", "text"]) if (typeof person[k] !== "string") p.push(`${at} has no ${k}`);
      if (!isPoint(person.at)) p.push(`${at} has no at { x, y }`);
      if (!isStrings(person.times)) p.push(`${at}'s times aren't a list of times of day`);
      for (const k of ["color", "kind"]) if (person[k] !== undefined && typeof person[k] !== "string") p.push(`${at}'s ${k} isn't text`);
      if (person.states !== undefined && !isStrings(person.states)) p.push(`${at}'s states aren't a list of text`);
      if (person.blocks !== undefined && typeof person.blocks !== "boolean") p.push(`${at}'s blocks isn't true or false`);
    });
  }
  return p;
}

/** What's wrong with a value's shape as a place, each problem naming where: [] when it's one. */
export function placeShapeProblems(value: unknown): string[] {
  if (!isObject(value)) return ["it isn't a JSON object"];
  const d = value, p: string[] = [];
  envelopeProblems(d, "place", p);
  if (!(isObject(d.size) && typeof d.size.w === "number" && typeof d.size.h === "number")) p.push("it has no size { w, h } (in feet)");
  const areas = Array.isArray(d.areas) ? d.areas : (p.push("it has no areas list"), []);
  areas.forEach((a, i) => {
    const at = `areas[${i}]${isObject(a) && typeof a.id === "string" ? ` (${a.id})` : ""}`;
    if (!isObject(a)) return p.push(`${at} isn't an object`);
    if (!nonEmpty(a.id)) p.push(`${at} has no id`);
    if (typeof a.name !== "string") p.push(`${at} has no name`);
    if (!isRect(a.rect)) p.push(`${at} has no rect { x, y, w, h }`);
    if (a.description !== undefined && typeof a.description !== "string") p.push(`${at}'s description isn't text`);
    for (const k of ["tags", "states"]) if (a[k] !== undefined && !isStrings(a[k])) p.push(`${at}'s ${k} aren't a list of text`);
  });
  const things = Array.isArray(d.things) ? d.things : (p.push("it has no things list"), []);
  things.forEach((t, i) => p.push(...thingProblems(t, `things[${i}]${isObject(t) && typeof t.id === "string" ? ` (${t.id})` : ""}`)));
  if (!isObject(d.people)) p.push("it has no people { id: { in, at? } }");
  else for (const [id, person] of Object.entries(d.people)) {
    const fits = isObject(person) && nonEmpty(person.in) && (person.at === undefined || isPair(person.at)) && (person.note === undefined || typeof person.note === "string");
    if (!fits) p.push(`people.${id} isn't { in, at?: [x, y], note? }`);
  }
  return p;
}

/** A thing of a place: what buildWorld reads of it, its kind, size and material among the world's. */
function thingProblems(t: unknown, at: string): string[] {
  if (!isObject(t)) return [`${at} isn't an object`];
  const p: string[] = [];
  for (const k of ["id", "in"]) if (!nonEmpty(t[k])) p.push(`${at} has no ${k}`);
  if (typeof t.name !== "string") p.push(`${at} has no name`);
  if (t.kind !== undefined && !THING_KINDS.includes(t.kind as NonNullable<ThingSpec["kind"]>)) p.push(`${at}'s kind ${JSON.stringify(t.kind)} isn't one of ${THING_KINDS.join(", ")}`);
  if (t.size !== undefined && !SIZES.includes(t.size as Size)) p.push(`${at}'s size ${JSON.stringify(t.size)} isn't one of ${SIZES.join(", ")}`);
  if (t.material !== undefined && !MATERIALS.includes(t.material as Material)) p.push(`${at}'s material ${JSON.stringify(t.material)} isn't one of ${MATERIALS.join(", ")}`);
  if (t.at !== undefined && !isPair(t.at)) p.push(`${at}'s at isn't a spot [x, y] (in feet)`);
  for (const k of ["tags", "states"]) if (t[k] !== undefined && !isStrings(t[k])) p.push(`${at}'s ${k} aren't a list of text`);
  if (t.description !== undefined && typeof t.description !== "string") p.push(`${at}'s description isn't text`);
  for (const k of ["ac", "hp", "quantity"]) if (t[k] !== undefined && typeof t[k] !== "number") p.push(`${at}'s ${k} isn't a number`);
  return p;
}

/** The kinds, sizes and materials a thing may have (scene-world.ts's ThingSpec, Size and Material). */
export const THING_KINDS = ["feature", "object", "item", "creature", "person"] as const satisfies ReadonlyArray<NonNullable<ThingSpec["kind"]>>;
export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const satisfies readonly Size[];
export const MATERIALS = ["cloth", "paper", "rope", "glass", "ice", "crystal", "wood", "bone", "leather", "stone", "iron", "steel", "brass", "silver", "flesh", "liquid"] as const satisfies readonly Material[];
// Every one of the world's, too: a kind, size or material added there and not here fails the type check.
type Every<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const _every: [Every<NonNullable<ThingSpec["kind"]>, typeof THING_KINDS[number]>, Every<Size, typeof SIZES[number]>, Every<Material, typeof MATERIALS[number]>] = [true, true, true];

const TIMES: TimeOfDay[] = ["morning", "afternoon", "evening", "night", "next-morning"];

function envelopeProblems(d: Record<string, unknown>, kind: string, p: string[], before = false): void {
  if (d.format !== "kingmaker" || !(d.version === 2 || before) || d.kind !== kind) {
    p.push(`it isn't a ${kind} of the kingmaker format, version 2 (format ${JSON.stringify(d.format)}, version ${JSON.stringify(d.version)}, kind ${JSON.stringify(d.kind)})`);
  }
  if (!nonEmpty(d.id)) p.push("it has no id");
  for (const k of ["title", "description"]) if (typeof d[k] !== "string") p.push(`it has no ${k}`);
}

function parsed(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FormatError(where, [`it isn't JSON (${(e as Error).message})`]);
  }
}

function held(problems: string[], value: unknown, where: string): unknown {
  if (problems.length) throw new FormatError(where, problems);
  return value;
}

function stringList(o: Record<string, unknown>, key: string, p: string[], at: string): void {
  if (!isStrings(o[key])) p.push(`${at}${key} isn't a list of text`);
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === "string");
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number");
const isPoint = (v: unknown): v is { x: number; y: number } => isObject(v) && typeof v.x === "number" && typeof v.y === "number";
const isRect = (v: unknown): boolean => isPoint(v) && typeof (v as Record<string, unknown>).w === "number" && typeof (v as Record<string, unknown>).h === "number";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
