import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CreationWorld } from "../../shared/creation/types.ts";
import { inBounds, isStructure, mapOf, tileAt, type MapDef } from "../../shared/map/tiles.ts";
import type { TileMap } from "../../shared/map/types.ts";
import { isBeat, isDiscovery, isEnding, shapeProblems, type SceneDocument } from "../../shared/scene/document.ts";
import type { BuildsFile, CampaignFile, CampaignPack, LooksFile, PlaceFile } from "../../shared/scene/files.ts";
import { mapPath, placePath, SCENARIO_EXTENSION } from "../../shared/scene/scenario.ts";
import { sceneRuleProblems, sceneStoryProblems, type SceneContext } from "../../shared/scene/rules.ts";
import { TOLD } from "../../shared/scene/talk.ts";
import { VOCABULARY, vocabularyOf } from "../../ai/gm/story.ts";
import { campaignOf, packOf, scenarioPathOf, scenePath, type CampaignFiles } from "./pack.ts";
import { vocabularyProblems } from "./vocabulary.ts";

/**
 * A campaign folder (campaigns/<id>/) as the install sends it, and the check that it's fit to
 * send (v0-design §8; the converter's checks that need no prototype, content-world A10; the
 * vocabulary's, v5-design §3.8). Both work on the folder's files in memory, so the AI service's PUT
 * carries exactly what was checked. The structure the install takes from them is pack.ts's (packOf),
 * which touches no Node, and is re-exported here.
 */

export { campaignOf, packOf, scenarioPathOf, scenePath, type CampaignFiles } from "./pack.ts";

/** A campaign folder's campaign as the game keeps it, from its scenario (its one <id>.kmscenario at the root): what a host needs to know of it before an install (its id and version, say). */
export function readCampaign(dir: string): CampaignFile {
  return campaignOf(Object.fromEntries(readdirSync(dir).filter(name => name.endsWith(SCENARIO_EXTENSION)).map(name => [name, readFileSync(join(dir, name), "utf8")])));
}

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

/** The vendored pack, read from vendor/: what the module and the AI service load. */
export function vendoredPack(): RulesPack {
  return rulesPackOf(readFileSync(join(import.meta.dirname, "..", "..", "vendor", "dnd-srd-engine", "starter-pack.json"), "utf8"));
}

/** What's wrong with a campaign, each problem a line naming where: [] when it's fit to install. The builds are held to the rules engine's pack. */
export function checkCampaign(files: CampaignFiles, rules: RulesPack = vendoredPack()): string[] {
  let pack: CampaignPack, scenario: string;
  try {
    scenario = scenarioPathOf(files);
    pack = packOf(files);
  } catch (e) {
    return [(e as Error).message];
  }

  // A scene whose file isn't of the format's shape (document.ts) is held to nothing more: its problems are its shape's.
  const keys = [...pack.campaign.scenes, ...(pack.campaign.talk ? [pack.campaign.talk] : [])];
  const shaped = pack.scenes.map((doc, i) => ({ key: keys[i]!, doc, problems: shapeProblems(doc) }));
  const whole: CampaignPack = { ...pack, scenes: shaped.filter(s => !s.problems.length).map(s => s.doc) };

  return [
    ...campaignProblems(pack, rules, scenario),
    ...creationProblems(pack.campaign.creation, files, scenario),
    ...shaped.flatMap(s => s.problems.map(p => `${scenePath(s.key)}: ${p}`)),
    ...shaped.filter(s => !s.problems.length).flatMap(s => sceneProblems(s.key, s.doc, files, whole, pack.scenes)),
    ...talkProblems(whole, files, scenario),
    ...storyProblems(whole, scenario),
    ...pack.places.flatMap((place, i) => placeProblems(place, pack.campaign.places[i]!)),
    ...buildProblems(pack.builds, rules),
    ...lookProblems(pack.looks, pack.scenes.flatMap(s => (Array.isArray(s?.cast) ? s.cast.map(c => c?.id) : []))),
    ...mapProblems(pack, scenario),
    ...vocabularyProblems(files, whole),
  ];
}

/**
 * A short account of a pack: "caerwyn 0.1.0: 6 scenes (35 beats, 63 routes, 21 endings), a talk
 * template, 4 places, 4 maps, 154 lore docs, 5 builds, 13 looks, the vocabulary of 19 scenes (44c6d4a)".
 */
export function describePack(pack: CampaignPack, files: CampaignFiles): string {
  const scenes = pack.scenes.filter(scene => scene.id !== pack.campaign.talk);
  const routes = scenes.reduce((n, s) => n + s.edges.length, 0);
  const beats = scenes.reduce((n, s) => n + s.nodes.filter(isBeat).length, 0), endings = scenes.reduce((n, s) => n + s.nodes.filter(isEnding).length, 0);
  const lore = Object.keys(files).filter(p => p.startsWith("lore/")).length;
  const vocabulary = files[VOCABULARY] === undefined ? undefined : vocabularyOf(files[VOCABULARY]);
  return `${pack.campaign.id} ${pack.campaign.version}: ${count(scenes.length, "scene")} (${count(beats, "beat")}, ${count(routes, "route")}, ${count(endings, "ending")}), `
    + `${pack.campaign.talk ? "a talk template, " : ""}${count(pack.places.length, "place")}, ${pack.maps.length ? `${count(pack.maps.length, "map")}, ` : ""}${count(lore, "lore doc")}, ${count(Object.keys(pack.builds).length, "build")}, ${count(Object.keys(pack.looks).length, "look")}`
    + (vocabulary && !Array.isArray(vocabulary) ? `, the vocabulary of ${count(vocabulary.scenes.length, "scene")} (${vocabulary.source})` : "");
}

// ---------------------------------------------------------------------------------------------
// The checks, a part of the pack each.

function campaignProblems(pack: CampaignPack, rules: RulesPack, at: string): string[] {
  const c = pack.campaign, problems: string[] = [];
  for (const field of ["id", "title", "version", "firstScene", "startPlace"] as const) if (typeof c[field] !== "string" || !c[field]) problems.push(`${at}: no ${field}`);
  if (!c.scenes.includes(c.firstScene)) problems.push(`${at}: the first scene ${c.firstScene} isn't one of its scenes`);
  if (!c.places.includes(c.startPlace)) problems.push(`${at}: the start place ${c.startPlace} isn't one of its places`);
  if (!Number.isInteger(c.level) || c.level < 1) problems.push(`${at}: level ${c.level} isn't a level`);
  if (c.rulesPack !== rules.id) problems.push(`${at}: its rulesPack ${c.rulesPack} isn't the rules engine's pack, ${rules.id}`);
  return problems;
}

/**
 * The world a backstory is written for and checked against (the scenario's creation): its primer,
 * the docs the lore check leaves out and each place's doc are in lore/, and each place's words (when
 * the check reads its doc) are a regular expression.
 */
function creationProblems(world: CreationWorld | undefined, files: CampaignFiles, scenario: string): string[] {
  const at = `${scenario}: creation`;
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

/**
 * A scene held to the format's rules (docs/scene-format.md, "Rules the campaign check enforces"), its
 * shape already whole: shared/scene/rules.ts has them (the Obsidian plugin runs the same rules as a
 * scene is edited), and the campaign folder is what they need of the campaign around the scene (its
 * lore, scenes, places and quests, and its other scenes for what the story carries between them).
 */
function sceneProblems(key: string, doc: SceneDocument, files: CampaignFiles, pack: CampaignPack, all: SceneDocument[]): string[] {
  const context: SceneContext = {
    hasLore: path => files[`lore/${path}`] !== undefined,
    scenes: pack.campaign.scenes,
    ...(pack.campaign.talk === undefined ? {} : { talk: pack.campaign.talk }),
    places: pack.places,
    quests: pack.campaign.quests ?? {},
    others: all.filter(other => other !== doc),
  };
  return sceneRuleProblems(key, doc, context).map(problem => `${scenePath(key)}: ${problem.message}`);
}

/**
 * The talk template (the scenario's `talk`, town-design §3.6), held to the talk's own rules: a scene
 * whose companion is `{companion}`, its first cast entry whoever walks with the player (`{companion}`,
 * named `{name}`), with the event beat the one thing they were keeping back moves the talk to (TOLD),
 * the ending walking on ends it at (goodbye) and no place of its own; and everyone the story has walk
 * with the player (a `follow` effect) has a lore entry to be themselves from (the AI service builds
 * their talks from it: a talk with someone who hasn't is refused).
 */
function talkProblems(pack: CampaignPack, files: CampaignFiles, scenario: string): string[] {
  const key = pack.campaign.talk;
  if (key === undefined) return [];
  const template = pack.scenes.find(scene => scene.id === key);
  if (!template) return files[scenePath(key)] === undefined ? [`${scenario}: its talk template ${scenePath(key)} isn't there`] : [];
  const at = scenePath(key), problems: string[] = [];
  if (template.companion !== "{companion}") problems.push(`${at}: the talk template's companion is ${JSON.stringify(template.companion)}, not "{companion}"`);
  const [first] = template.cast;
  if (first?.id !== "{companion}" || first.name !== "{name}") problems.push(`${at}: the talk template's first cast entry isn't the companion's ({companion}, named {name})`);
  const told = template.nodes.find(n => n.id === TOLD);
  if (!told || !isBeat(told) || isDiscovery(told)) problems.push(`${at}: the talk template has no event beat ${TOLD} (where the one thing they keep back takes the talk once it's told)`);
  if (!template.nodes.some(n => n.id === GOODBYE && isEnding(n))) problems.push(`${at}: the talk template has no ending ${GOODBYE} (where walking on ends a talk)`);
  if (template.place !== undefined) problems.push(`${at}: the talk template has a place (a talk is wherever the player stopped)`);
  const followers = new Set(pack.scenes.flatMap(scene => [...(scene.onEnd ?? []), ...scene.nodes.filter(isEnding).flatMap(n => n.data.effects ?? [])])
    .flatMap(e => (e.op === "follow" ? [e.who] : [])));
  const entries = new Set(Object.entries(files).filter(([path]) => path.startsWith("lore/") && path.endsWith("/private.md"))
    .map(([, text]) => /^character:\s*"?([^"\n]+)"?\s*$/m.exec(text)?.[1]).filter((id): id is string => !!id));
  for (const who of followers) if (!entries.has(who)) problems.push(`${at}: ${who} walks with the player, but has no lore entry to talk from (a private.md with character: ${who})`);
  return problems;
}

/** The ending a talk ends at when the player walks on (simulation/src/map/talk.ts walkOn). */
const GOODBYE = "goodbye";

/**
 * The story between scenes (story-design §4.6): where the story goes when a scene is overtaken is a
 * scene of the campaign, and a scene that can be overtaken says what it assumes; an interlude
 * (downtime the story skips) has an ending that goes on; and each of the story's quests has a title.
 * (An ending's next is each scene's own check.)
 */
function storyProblems(pack: CampaignPack, scenario: string): string[] {
  const scenes = new Set(pack.scenes.map(scene => scene.id));
  const problems = pack.scenes.flatMap(scene => sceneStoryProblems(scene, scenes).map(p => `${scenePath(scene.id)}: ${p.message}`));
  for (const [key, title] of Object.entries(pack.campaign.quests ?? {})) if (typeof title !== "string" || !title.trim()) problems.push(`${scenario}: quest ${key} has no title`);
  return problems;
}

/** A place: unique ids, and every thing and person in an area, a thing or a person that exists. */
function placeProblems(place: PlaceFile, key: string): string[] {
  const at = placePath(key), problems: string[] = [];
  if (place.key !== key) problems.push(`${at}: its id ${place.key} isn't its file's name`);
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
function mapProblems(pack: CampaignPack, scenario: string): string[] {
  const problems: string[] = [];
  // The campaign's maps by id, and those that build (a way out to one that doesn't is that map's problem, not the way's).
  const ids = new Set(pack.maps.map(m => m.id));
  const built = new Map<string, TileMap>();
  pack.maps.forEach((file, i) => {
    const key = pack.campaign.maps?.[i] ?? file.id;
    const at = mapPath(key);
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
    const at = mapPath(id);
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
    if (!ids.has(start.map)) problems.push(`${scenario}: it starts on the map ${start.map}, which isn't one of its maps`);
    else if (!tile) problems.push(`${scenario}: it starts on ${start.map} but doesn't say where (start.at)`);
    else if (map && !standable(map, tile)) problems.push(`${scenario}: it starts at (${tile.x}, ${tile.y}) on ${start.map}, where nobody can stand`);
  } else if (start.at) problems.push(`${scenario}: it says where to start (start.at) but not on which map`);
  return problems;
}

const TIMES: string[] = ["morning", "afternoon", "evening", "night", "next-morning"];

/** Somewhere a person can stand: open ground, or a doorway that isn't locked (explore.ts's walkable). */
function standable(map: TileMap, p: { x: number; y: number }): boolean {
  if (!inBounds(map, p)) return false;
  const t = tileAt(map, p);
  return !t.blocks && (!isStructure(t) || t.terrain === "door");
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
