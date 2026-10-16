import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CreationWorld } from "../../shared/creation/types.ts";
import { inBounds, isStructure, mapOf, tileAt, type MapDef, type MapFile } from "../../shared/map/tiles.ts";
import type { TileMap } from "../../shared/map/types.ts";
import type { BuildsFile, CampaignFile, CampaignPack, Effect, LooksFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import { validateScene, type Scene } from "../../shared/scene/types.ts";
import { VOCABULARY, vocabularyOf } from "../../ai/gm/story.ts";
import { vocabularyProblems } from "./vocabulary.ts";

/**
 * A campaign folder (v2/campaigns/<id>/) as the install sends it, and the check that it's fit to
 * send (v0-design §8; the converter's checks that need no prototype, content-world A10; the
 * vocabulary's, v5-design §3.8). Both work on the folder's files in memory, so the AI service's PUT
 * carries exactly what was checked.
 */

/** A campaign folder's files by path ("scenes/hanged-clerk/setting.md"): every file, dotfiles left out. */
export type CampaignFiles = Record<string, string>;

/** Every file under a folder, by its path in it with "/" separators, in path order. */
export function readCampaignFiles(dir: string): CampaignFiles {
  const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter(path => !path.split("/").some(part => part.startsWith(".")))
    .sort();
  return Object.fromEntries(paths.map(path => [path, readFileSync(join(dir, path), "utf8")]));
}

/**
 * The structure install_campaign takes: campaign.json, each listed scene's scene.json with its hook
 * (hook.md, as the loader reads it), each listed place, the builds, the looks and each listed map.
 * Throws when a file it needs is missing or isn't JSON.
 */
export function packOf(files: CampaignFiles): CampaignPack {
  const campaign = json<CampaignFile>(files, "campaign.json");
  return {
    campaign,
    scenes: campaign.scenes.map(key => ({ scene: json<SceneFile>(files, `scenes/${key}/scene.json`), hook: text(files, `scenes/${key}/hook.md`).trim() })),
    places: campaign.places.map(key => json<PlaceFile>(files, `places/${key}.json`)),
    builds: json<BuildsFile>(files, "builds.json"),
    looks: json<LooksFile>(files, "looks.json"),
    maps: (campaign.maps ?? []).map(key => json<MapFile>(files, `maps/${key}.json`)),
  };
}

/**
 * The rules engine's content pack as a campaign is checked against (v1-design §3.9): its id@version,
 * and the ids its builds may name (each subclass with its class).
 */
export interface RulesPack { id: string; classes: string[]; species: string[]; backgrounds: string[]; subclasses: Record<string, string> }

/** The vendored pack's (vendor/dnd-srd-engine/starter-pack.json), as the engine reads it. */
export function rulesPackOf(json: string): RulesPack {
  const pack = JSON.parse(json) as { id: string; version: string; classes: Array<{ id: string }>; species: Array<{ id: string }>; backgrounds: Array<{ id: string }>; subclasses: Array<{ id: string; parentClassId: string }> };
  const ids = (list: Array<{ id: string }>) => list.map(x => x.id);
  return {
    id: `${pack.id}@${pack.version}`, classes: ids(pack.classes), species: ids(pack.species), backgrounds: ids(pack.backgrounds),
    subclasses: Object.fromEntries(pack.subclasses.map(s => [s.id, s.parentClassId])),
  };
}

/** The vendored pack, read from v2/vendor: what the module and the AI service load. */
export function vendoredPack(): RulesPack {
  return rulesPackOf(readFileSync(join(import.meta.dirname, "..", "..", "vendor", "dnd-srd-engine", "starter-pack.json"), "utf8"));
}

/** What's wrong with a campaign, each problem a line naming where: [] when it's fit to install. The builds are held to the rules engine's pack. */
export function checkCampaign(files: CampaignFiles, rules: RulesPack = vendoredPack()): string[] {
  let pack: CampaignPack;
  try {
    pack = packOf(files);
  } catch (e) {
    return [(e as Error).message];
  }

  return [
    ...campaignProblems(pack, rules),
    ...creationProblems(pack.campaign.creation, files),
    ...pack.scenes.flatMap(({ scene }) => sceneProblems(scene, files, pack)),
    ...pack.places.flatMap((place, i) => placeProblems(place, pack.campaign.places[i]!)),
    ...buildProblems(pack.builds, rules),
    ...lookProblems(pack.looks, pack.scenes.flatMap(s => s.scene.cast.map(c => c.id))),
    ...mapProblems(pack),
    ...vocabularyProblems(files, pack),
  ];
}

/**
 * A short account of a pack: "caerwyn 0.1.0: 1 scene (5 beats, 37 routes, 5 exits), 1 place, 4 maps,
 * 154 lore docs, 3 builds, 4 looks, the vocabulary of 25 scenes (44c6d4a)".
 */
export function describePack(pack: CampaignPack, files: CampaignFiles): string {
  const scenes = pack.scenes.map(({ scene }) => sceneOf(scene));
  const routes = scenes.reduce((n, s) => n + s.beats.reduce((m, b) => m + b.transitions.length, 0) + (s.anytime?.length ?? 0), 0);
  const beats = scenes.reduce((n, s) => n + s.beats.length, 0), exits = scenes.reduce((n, s) => n + s.exits.length, 0);
  const lore = Object.keys(files).filter(p => p.startsWith("lore/")).length;
  const vocabulary = files[VOCABULARY] === undefined ? undefined : vocabularyOf(files[VOCABULARY]);
  return `${pack.campaign.id} ${pack.campaign.version}: ${count(scenes.length, "scene")} (${count(beats, "beat")}, ${count(routes, "route")}, ${count(exits, "exit")}), `
    + `${count(pack.places.length, "place")}, ${pack.maps.length ? `${count(pack.maps.length, "map")}, ` : ""}${count(lore, "lore doc")}, ${count(Object.keys(pack.builds).length, "build")}, ${count(Object.keys(pack.looks).length, "look")}`
    + (vocabulary && !Array.isArray(vocabulary) ? `, the vocabulary of ${count(vocabulary.scenes.length, "scene")} (${vocabulary.source})` : "");
}

// ---------------------------------------------------------------------------------------------
// The checks, a part of the pack each.

function campaignProblems(pack: CampaignPack, rules: RulesPack): string[] {
  const c = pack.campaign, problems: string[] = [];
  for (const field of ["id", "title", "version", "firstScene", "startPlace"] as const) if (typeof c[field] !== "string" || !c[field]) problems.push(`campaign.json: no ${field}`);
  if (!c.scenes.includes(c.firstScene)) problems.push(`campaign.json: the first scene ${c.firstScene} isn't one of its scenes`);
  if (!c.places.includes(c.startPlace)) problems.push(`campaign.json: the start place ${c.startPlace} isn't one of its places`);
  if (!Number.isInteger(c.level) || c.level < 1) problems.push(`campaign.json: level ${c.level} isn't a level`);
  if (c.rulesPack !== rules.id) problems.push(`campaign.json: its rulesPack ${c.rulesPack} isn't the rules engine's pack, ${rules.id}`);
  return problems;
}

/**
 * The world a backstory is written for and checked against (campaign.json's creation): its primer,
 * the docs the lore check leaves out and each place's doc are in lore/, and each place's words (when
 * the check reads its doc) are a regular expression.
 */
function creationProblems(world: CreationWorld | undefined, files: CampaignFiles): string[] {
  const at = "campaign.json: creation";
  if (!world || typeof world !== "object") return [`${at} is missing`];
  const problems: string[] = [];
  for (const field of ["name", "premise", "primer"] as const) if (typeof world[field] !== "string" || !world[field].trim()) problems.push(`${at} has no ${field}`);
  const docs = [world.primer, ...(world.notCanon ?? []), ...(world.places ?? []).map(p => p.doc)];
  for (const doc of docs) if (typeof doc === "string" && files[`lore/${doc}`] === undefined) problems.push(`${at}: ${doc} isn't in lore/`);
  for (const place of world.places ?? []) {
    try { new RegExp(place.words, "i"); } catch (e) { problems.push(`${at}: ${place.doc}'s words aren't a regular expression (${(e as Error).message})`); }
  }
  return problems;
}

/** A scene: it loads with its words and without them (as the simulation loads it), and every id it names exists. */
function sceneProblems(file: SceneFile, files: CampaignFiles, pack: CampaignPack): string[] {
  const at = `scenes/${file.id}`;
  const problems: string[] = [];
  if (!pack.campaign.scenes.includes(file.id)) problems.push(`${at}/scene.json: its id ${file.id} isn't its folder's name`);

  const scene = loads(() => sceneOf(file, path => files[`${at}/${path}`]), problems, at, file.id);
  loads(() => sceneOf(file), problems, `${at} (without its words)`, file.id);
  const place = file.place ? pack.places.find(p => p.key === file.place) : undefined;
  if (file.place && !place) problems.push(`${at}: its place ${file.place} isn't one of the campaign's places`);
  if (scene) problems.push(...validateScene({ ...scene, ...(place ? { world: place } : {}) }).map(p => `${at}: ${p}`));

  const cast = new Set(file.cast.map(c => c.id));
  const keys = new Set([...cast, ...(place ? [...place.areas.map(a => a.id), ...place.things.map(t => t.id)] : [])]);
  problems.push(
    ...Object.entries(file.exits).flatMap(([id, exit]) => exit.effects.flatMap(e => effectProblems(e, keys, cast, file.facts).map(p => `${at}: exit ${id}: ${p}`))),
    ...file.afterwards.flatMap(op => namedKeys(op).filter(k => !keys.has(k)).map(k => `${at}: afterwards: ${op.op} names unknown ${k}`)),
    ...Object.keys(place?.people ?? {}).filter(id => id !== "player" && !cast.has(id)).map(id => `${at}: ${file.place}'s people: ${id} isn't in the cast`),
    ...[...file.lore, ...(file.fronts ? [file.fronts] : [])].filter(p => files[`lore/${p}`] === undefined).map(p => `${at}: lore ${p} isn't in lore/`),
  );
  return problems;
}

/** An exit's effect: its condition on a known fact, and the cast or things it names. */
function effectProblems(effect: Effect, keys: Set<string>, cast: Set<string>, facts: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const cond of [effect.if, effect.unless]) if (cond && !(cond.established in facts)) problems.push(`condition on unknown fact ${cond.established}`);
  if (effect.op === "attitude" || effect.op === "remember") {
    if (!cast.has(effect.who)) problems.push(`${effect.op} names unknown ${effect.who}`);
  } else if (effect.op !== "quest" && effect.op !== "flag" && effect.op !== "journal") {
    for (const k of namedKeys(effect)) if (!keys.has(k)) problems.push(`${effect.op} names unknown ${k}`);
  }
  return problems;
}

/** The keys a world operation names (what it acts on, where it goes); "$player" is the controller's character. */
function namedKeys(op: { what?: string; to?: string }): string[] {
  return [op.what, op.to].filter((k): k is string => !!k && k !== "$player");
}

/** A place: unique ids, and every thing and person in an area, a thing or a person that exists. */
function placeProblems(place: PlaceFile, key: string): string[] {
  const at = `places/${key}.json`, problems: string[] = [];
  if (place.key !== key) problems.push(`${at}: its key ${place.key} isn't its file's name`);
  const ids = [...place.areas.map(a => a.id), ...place.things.map(t => t.id), ...Object.keys(place.people)];
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`${at}: ${id} is there twice`);
  const known = new Set(ids), areas = new Set(place.areas.map(a => a.id));
  for (const t of place.things) if (!known.has(t.in)) problems.push(`${at}: thing ${t.id} is in unknown ${t.in}`);
  for (const [id, p] of Object.entries(place.people)) if (!areas.has(p.in)) problems.push(`${at}: ${id} starts in unknown area ${p.in}`);
  return problems;
}

/**
 * The ready-made characters (v1-design §3.9): each a concept, and a build for the rules engine to
 * make, with every field of one, its class, species, background and subclass on the pack's lists.
 */
function buildProblems(builds: BuildsFile, rules: RulesPack): string[] {
  const problems: string[] = [];
  if (!Object.keys(builds).length) problems.push("builds.json: no builds");
  for (const [id, { concept, build }] of Object.entries(builds)) {
    const at = `builds.json: ${id}`;
    if (typeof concept !== "string" || !concept.trim()) problems.push(`${at}: no concept`);
    if (!build || typeof build !== "object") { problems.push(`${at}: no build`); continue; }
    for (const field of BUILD_IDS) if (typeof build[field] !== "string") problems.push(`${at}: the build has no ${field}`);
    for (const field of BUILD_LISTS) if (!Array.isArray(build[field]) || build[field].some(x => typeof x !== "string")) problems.push(`${at}: the build's ${field} isn't a list of ids`);
    if (typeof build.shield !== "boolean") problems.push(`${at}: the build's shield isn't true or false`);
    problems.push(...packProblems(build, rules).map(p => `${at}: ${p}`));
  }
  return problems;
}

/** A build's ids the rules engine's pack hasn't got (install_campaign refuses them: bad_pack), and a subclass of another class. */
function packProblems(build: BuildsFile[string]["build"], rules: RulesPack): string[] {
  const missing = ([["class", build.classId, rules.classes], ["species", build.speciesId, rules.species], ["background", build.backgroundId, rules.backgrounds]] as const)
    .filter(([, id, list]) => typeof id === "string" && !list.includes(id))
    .map(([what, id]) => `its ${what} ${id} isn't in ${rules.id}`);
  const parent = typeof build.subclassId === "string" ? rules.subclasses[build.subclassId] : undefined;
  if (typeof build.subclassId === "string" && !parent) missing.push(`its subclass ${build.subclassId} isn't in ${rules.id}`);
  else if (parent && typeof build.classId === "string" && parent !== build.classId) missing.push(`its subclass ${build.subclassId} is the ${parent}'s, not the ${build.classId}'s`);
  return missing;
}

const BUILD_IDS = ["classId", "subclassId", "speciesId", "backgroundId", "feat", "armor"] as const;
const BUILD_LISTS = ["abilities", "skills", "cantrips", "spells", "weapons"] as const;

/** The cast's looks: each names someone in a scene's cast, with a role, one glyph and a colour. */
function lookProblems(looks: LooksFile, castIds: string[]): string[] {
  return Object.entries(looks).flatMap(([id, look]) => [
    ...(castIds.includes(id) ? [] : [`looks.json: ${id} isn't in any scene's cast`]),
    ...(typeof look.role === "string" && look.role ? [] : [`looks.json: ${id} has no role`]),
    ...([...(look.glyph ?? "")].length === 1 ? [] : [`looks.json: ${id}'s glyph ${JSON.stringify(look.glyph)} isn't one character`]),
    ...(/^#[0-9a-f]{6}$/i.test(look.fg ?? "") ? [] : [`looks.json: ${id}'s colour ${JSON.stringify(look.fg)} isn't #rrggbb`]),
  ]);
}

/**
 * The maps (map-design §3.1): each listed map's file named for its id, building as the simulation
 * builds it (mapOf); its regions inside it, their ids unique across the maps (a scene's place is
 * found by its region's id); its ways out to maps the campaign has, onto tiles there a person can
 * stand on; its people somewhere on it, about at times of day. And the start on a map: one of
 * them, on a tile a person can stand on.
 */
function mapProblems(pack: CampaignPack): string[] {
  const problems: string[] = [];
  // The campaign's maps by id, and those that build (a way out to one that doesn't is that map's problem, not the way's).
  const ids = new Set(pack.maps.map(m => m.id));
  const built = new Map<string, TileMap>();
  pack.maps.forEach((file, i) => {
    const key = pack.campaign.maps?.[i] ?? file.id;
    const at = `maps/${key}.json`;
    if (file.id !== key) problems.push(`${at}: its id ${file.id} isn't its file's name`);
    let def: MapDef;
    try {
      def = mapOf(file);
    } catch (e) {
      problems.push(`${at}: it doesn't build (${(e as Error).message})`);
      return;
    }
    built.set(file.id, def.map);
    for (const p of file.people ?? []) {
      if (!inBounds(def.map, p.at)) problems.push(`${at}: ${p.name} at (${p.at.x}, ${p.at.y}) is off the map`);
      const odd = (p.times ?? []).filter(t => !TIMES.includes(t));
      if (!p.times?.length || odd.length) problems.push(`${at}: ${p.name}'s times ${JSON.stringify(p.times)} aren't times of day`);
    }
  });
  const regions = new Map<string, string>();
  for (const [id, map] of built) {
    const at = `maps/${id}.json`;
    for (const r of map.regions) {
      const inside = r.rect.x >= 0 && r.rect.y >= 0 && r.rect.w > 0 && r.rect.h > 0 && r.rect.x + r.rect.w <= map.width && r.rect.y + r.rect.h <= map.height;
      if (!inside) problems.push(`${at}: region ${r.id} isn't inside the map`);
      if (regions.has(r.id)) problems.push(`${at}: region ${r.id} is ${regions.get(r.id)}'s too`);
      else regions.set(r.id, id);
    }
    for (const e of map.exits) {
      const to = built.get(e.to.map);
      if (!inBounds(map, e.at)) problems.push(`${at}: "${e.label}" at (${e.at.x}, ${e.at.y}) is off the map`);
      if (!ids.has(e.to.map)) problems.push(`${at}: "${e.label}" goes to ${e.to.map}, which isn't one of the campaign's maps`);
      else if (to && !standable(to, e.to.at)) problems.push(`${at}: "${e.label}" lands on (${e.to.at.x}, ${e.to.at.y}) in ${e.to.map}, where nobody can stand`);
    }
  }
  const start = pack.campaign.start;
  if (start.map !== undefined) {
    const map = built.get(start.map);
    const tile = start.at ? { x: start.at[0], y: start.at[1] } : undefined;
    if (!ids.has(start.map)) problems.push(`campaign.json: it starts on the map ${start.map}, which isn't one of its maps`);
    else if (!tile) problems.push(`campaign.json: it starts on ${start.map} but doesn't say where (start.at)`);
    else if (map && !standable(map, tile)) problems.push(`campaign.json: it starts at (${tile.x}, ${tile.y}) on ${start.map}, where nobody can stand`);
  } else if (start.at) problems.push("campaign.json: it says where to start (start.at) but not on which map");
  return problems;
}

const TIMES: string[] = ["morning", "afternoon", "evening", "night", "next-morning"];

/** Somewhere a person can stand: open ground, or a doorway that isn't locked (explore.ts's walkable). */
function standable(map: TileMap, p: { x: number; y: number }): boolean {
  if (!inBounds(map, p)) return false;
  const t = tileAt(map, p);
  return !t.blocks && (!isStructure(t) || t.terrain === "door");
}

// ---------------------------------------------------------------------------------------------
// Reading.

function text(files: CampaignFiles, path: string): string {
  const found = files[path];
  if (found === undefined) throw new Error(`${path} is missing`);
  return found;
}

function json<T>(files: CampaignFiles, path: string): T {
  try {
    return JSON.parse(text(files, path)) as T;
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? `${path} isn't JSON: ${e.message}` : (e as Error).message);
  }
}

/** A scene loaded, or undefined with why it didn't load among the problems (the loader's own "<scene id>: " dropped). */
function loads(load: () => Scene, problems: string[], at: string, id: string): Scene | undefined {
  try {
    return load();
  } catch (e) {
    problems.push(`${at}: ${(e as Error).message.replace(`${id}: `, "")}`);
    return undefined;
  }
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
