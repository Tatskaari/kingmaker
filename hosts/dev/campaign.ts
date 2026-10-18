import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CreationWorld } from "../../shared/creation/types.ts";
import { inBounds, isStructure, mapOf, tileAt, type MapDef } from "../../shared/map/tiles.ts";
import type { TileMap } from "../../shared/map/types.ts";
import { isBeat, isDiscovery, isEnding, isStart, shapeProblems, type BeatData, type SceneDocument, type SceneNode } from "../../shared/scene/document.ts";
import type { BuildsFile, CampaignPack, Effect, LooksFile, PlaceFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import { GOODBYE, TOLD } from "../../shared/scene/talk.ts";
import { validateScene } from "../../shared/scene/types.ts";
import { VOCABULARY, vocabularyOf } from "../../ai/gm/story.ts";
import { packOf, scenePath, type CampaignFiles } from "./pack.ts";
import { vocabularyProblems } from "./vocabulary.ts";

/**
 * A campaign folder (campaigns/<id>/) as the install sends it, and the check that it's fit to
 * send (v0-design §8; the converter's checks that need no prototype, content-world A10; the
 * vocabulary's, v5-design §3.8). Both work on the folder's files in memory, so the AI service's PUT
 * carries exactly what was checked. The structure the install takes from them is pack.ts's (packOf),
 * which touches no Node, and is re-exported here.
 */

export { packOf, scenePath, type CampaignFiles } from "./pack.ts";

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
  let pack: CampaignPack;
  try {
    pack = packOf(files);
  } catch (e) {
    return [(e as Error).message];
  }

  // A scene whose file isn't of the format's shape (document.ts) is held to nothing more: its problems are its shape's.
  const keys = [...pack.campaign.scenes, ...(pack.campaign.talk ? [pack.campaign.talk] : [])];
  const shaped = pack.scenes.map((doc, i) => ({ key: keys[i]!, doc, problems: shapeProblems(doc) }));
  const whole: CampaignPack = { ...pack, scenes: shaped.filter(s => !s.problems.length).map(s => s.doc) };

  return [
    ...campaignProblems(pack, rules),
    ...creationProblems(pack.campaign.creation, files),
    ...shaped.flatMap(s => s.problems.map(p => `${scenePath(s.key)}: ${p}`)),
    ...shaped.filter(s => !s.problems.length).flatMap(s => sceneProblems(s.key, s.doc, files, whole, pack.scenes)),
    ...talkProblems(whole, files),
    ...storyProblems(whole),
    ...pack.places.flatMap((place, i) => placeProblems(place, pack.campaign.places[i]!)),
    ...buildProblems(pack.builds, rules),
    ...lookProblems(pack.looks, pack.scenes.flatMap(s => (Array.isArray(s?.cast) ? s.cast.map(c => c?.id) : []))),
    ...mapProblems(pack),
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

/**
 * A scene held to the format's rules (docs/scene-format.md, "Rules the campaign check enforces"), its
 * shape already whole: its ids, the prose it must have, its lore, its routes and what they require,
 * its discoveries' paths, that every node can be reached and it can end well, the evidence its good
 * endings need, the people and places it names, its effects, and that it loads as the game loads it.
 */
function sceneProblems(key: string, doc: SceneDocument, files: CampaignFiles, pack: CampaignPack, all: SceneDocument[]): string[] {
  const at = scenePath(key);
  const talk = doc.id === pack.campaign.talk;
  const problems: string[] = [];
  const p = (problem: string) => problems.push(`${at}: ${problem}`);
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  const castIds = new Set(doc.cast.map(c => c.id));
  const discoveries = doc.nodes.filter(isDiscovery);

  // Ids: slugs, the scene's its file's name (the cast's but the talk template's companion).
  if (doc.id !== key) p(`its id ${doc.id} isn't its file's name`);
  for (const [what, ids] of [["scene", [doc.id]], ["node", doc.nodes.map(n => n.id)], ["route", doc.edges.map(e => e.id)], ["cast", doc.cast.map(c => c.id)]] as const) {
    for (const id of ids) if (!SLUG.test(id) && !(talk && what === "cast" && id === "{companion}")) p(`the ${what} id ${JSON.stringify(id)} isn't a slug ([a-z0-9][a-z0-9-]*)`);
  }

  // The prose it must have (an interlude needs no premise or truth), each person's, each node's.
  for (const k of ["title", "description", "hook", "setting", "premise", "truth"] as const) if (!doc[k].trim() && !(doc.interlude && (k === "premise" || k === "truth"))) p(`it has no ${k}`);
  for (const c of doc.cast) for (const k of ["name", "look", "voice", "wants", "whyHere", "attitude"] as const) if (!c[k].trim()) p(`${c.id} has no ${k}`);
  for (const n of doc.nodes) {
    if (!n.data.title.trim() || !n.data.description.trim()) p(`${n.id} has no ${n.data.title.trim() ? "description" : "title"}`);
    if (isEnding(n) && !n.data.closing.trim()) p(`ending ${n.id} has no closing`);
  }

  // Its lore, its people's and its nodes' are in lore/.
  const lore = [...doc.lore, ...(doc.fronts ? [doc.fronts] : []), ...doc.cast.flatMap(c => (c.lore ? [c.lore] : [])), ...doc.nodes.flatMap(n => n.data.lore)];
  for (const path of new Set(lore)) if (files[`lore/${path}`] === undefined) p(`lore ${path} isn't in lore/`);

  // The routes: none leaves an ending, what they require is a beat, an empty condition is only into a discovery.
  for (const e of doc.edges) {
    if (nodes.get(e.source)?.data.kind === "exit") p(`route ${e.id} leaves an ending (${e.source})`);
    for (const r of e.data.requires ?? []) if (nodes.get(r)?.data.kind !== "beat") p(`route ${e.id} requires ${r}, which isn't a beat`);
    if (!e.data.condition.trim() && !isDiscovery(nodes.get(e.target)!)) p(`route ${e.id} has no condition, and only a route into a discovery may go without`);
    // A cue's outer limit counts from and until beats (from the start when it names none).
    for (const count of e.data.limit ?? []) for (const id of [...(count.after ? [count.after] : []), ...(count.until ?? [])]) if (nodes.get(id)?.data.kind !== "beat") p(`route ${e.id}'s outer limit counts from or until ${id}, which isn't a beat`);
  }

  // The discoveries: a revelation and two paths, three for one that's required (one free of dice); a way in that's no roll.
  for (const n of doc.nodes.filter(isBeat)) {
    const paths = n.data.paths ?? [];
    if (n.data.revelation === undefined) { if (paths.length) p(`beat ${n.id} has paths but no revelation`); continue; }
    if (!n.data.revelation.trim()) p(`discovery ${n.id} has no revelation`);
    if (paths.length < 2) p(`discovery ${n.id} has ${paths.length} path${paths.length === 1 ? "" : "s"}, not two or more`);
    if (n.data.required && (paths.length < 3 || paths.every(path => path.check))) p(`discovery ${n.id} is required, but hasn't three paths with one that needs no dice`);
    paths.forEach((path, i) => {
      for (const k of ["via", "clue", "earn"] as const) if (!path[k].trim()) p(`discovery ${n.id}'s path ${i + 1} has no ${k}`);
      if (!path.via.includes(" ") && !castIds.has(path.via)) p(`discovery ${n.id}'s path ${i + 1} is via ${path.via}, who isn't in the cast`);
    });
    if (!doc.edges.some(e => e.target === n.id && !e.data.skill)) p(`discovery ${n.id} is locked behind a roll: no route into it is free of dice`);
  }

  // Who comes on where, and whose notes the start and the events hold.
  for (const c of doc.cast) {
    const node = c.enters === undefined ? undefined : nodes.get(c.enters);
    if (c.enters !== undefined && !(node && isBeat(node) && !isDiscovery(node))) p(`${c.id} enters at ${c.enters}, which isn't an event beat`);
  }
  for (const n of doc.nodes) for (const id of Object.keys(("cast" in n.data ? n.data.cast : undefined) ?? {})) if (!castIds.has(id)) p(`${n.id} has a note for ${id}, who isn't in the cast`);

  // Every node can be reached from the start, and it can end well.
  const reached = reachable(doc);
  for (const n of doc.nodes) if (!reached.has(n.id)) p(`${n.id} can't be reached from the start`);
  const good = doc.nodes.filter(isEnding).filter(n => n.data.result !== "bad");
  if (!talk && !good.some(n => reached.has(n.id))) p("it has no good or mixed ending that can be reached");

  // What its good endings need: in a scene with a required discovery, each way into one says what it needs, and each required discovery is needed by one.
  const required = discoveries.filter(n => n.data.required);
  if (required.length) {
    const intoGood = doc.edges.filter(e => good.some(n => n.id === e.target && n.data.result === "good"));
    for (const e of intoGood) if (!e.data.requires?.length) p(`route ${e.id} goes to a good ending (${e.target}) but requires nothing found`);
    for (const n of required) if (!intoGood.some(e => e.data.requires?.includes(n.id))) p(`discovery ${n.id} is required, but no route into a good ending requires it`);
  }

  // Where the story goes, the place, and what the effects may name.
  for (const n of doc.nodes.filter(isEnding)) if (n.data.next && !pack.campaign.scenes.includes(n.data.next)) p(`ending ${n.id} goes on to ${n.data.next}, which isn't one of the campaign's scenes`);
  const place = doc.place ? pack.places.find(pl => pl.key === doc.place) : undefined;
  if (doc.place && !place) p(`its place ${doc.place} isn't one of the campaign's places`);
  const carried = carriedThings(all);
  const carriedElsewhere = carriedThings(all.filter(other => other !== doc));
  for (const n of doc.nodes.filter(isBeat)) for (const t of n.data.carry?.things ?? []) if (!place?.things.some(x => x.id === t) && !carriedElsewhere.has(t)) p(`beat ${n.id} carries ${t}, which isn't a thing of its place, nor carried from another scene`);
  // What an effect may name: the cast, the place's areas and things, and the things the story carries between scenes (Prout's page, owed into the Rat in Cob's boot).
  const keys = new Set([...castIds, ...(place ? [...place.areas.map(a => a.id), ...place.things.map(t => t.id)] : []), ...carried]);
  const effects: Array<[string, Effect]> = [
    ...(doc.onStart ?? []).map(e => ["onStart", e] as [string, Effect]),
    ...(doc.onEnd ?? []).map(e => ["onEnd", e] as [string, Effect]),
    ...doc.nodes.filter(isEnding).flatMap(n => (n.data.effects ?? []).map(e => [`ending ${n.id}`, e] as [string, Effect])),
  ];
  for (const [where, e] of effects) for (const problem of effectProblems(e, keys, castIds, doc.facts ?? {}, pack.campaign.quests ?? {})) p(`${where}: ${problem}`);
  for (const op of doc.afterwards ?? []) for (const k of namedKeys(op).filter(k => !keys.has(k))) p(`afterwards: ${op.op} names unknown ${k}`);
  for (const id of Object.keys(place?.people ?? {})) if (id !== "player" && !castIds.has(id)) p(`${doc.place}'s people: ${id} isn't in the cast`);

  // And, held to all that, it loads as the game loads it.
  if (!problems.length) {
    try {
      for (const problem of validateScene(sceneOf(doc))) p(problem);
    } catch (e) {
      p(`it doesn't load: ${(e as Error).message}`);
    }
  }
  return problems;
}

/** A slug, as the format's ids are. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The nodes reachable from the start, a route opening once its source and everything it requires are reached (the play's open routes, as a fixed point). */
function reachable(doc: SceneDocument): Set<string> {
  const reached = new Set(doc.nodes.filter(n => n.data.kind === "start").map(n => n.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of doc.edges) {
      if (reached.has(e.source) && !reached.has(e.target) && (e.data.requires ?? []).every(r => reached.has(r))) { reached.add(e.target); grew = true; }
      if (e.data.onFailure && reached.has(e.source) && !reached.has(e.data.onFailure) && (e.data.requires ?? []).every(r => reached.has(r))) { reached.add(e.data.onFailure); grew = true; }
    }
  }
  return reached;
}

/** The things the story carries between scenes: those of every carried beat of these scenes (what it owes goes with whoever has them), a file of the wrong shape's too, as far as it has them. */
function carriedThings(scenes: SceneDocument[]): Set<string> {
  const things = (n: SceneNode<BeatData>) => (Array.isArray(n?.data?.carry?.things) ? n.data.carry.things.filter(t => typeof t === "string") : []);
  return new Set(scenes.flatMap(doc => (Array.isArray(doc?.nodes) ? (doc.nodes as Array<SceneNode<BeatData>>).flatMap(things) : [])));
}

/**
 * An exit's effect (or onEnd's): an op the story knows, its condition on known facts, the cast or
 * things it names, and a quest campaign.json titles (story-design §4.6).
 */
function effectProblems(effect: Effect, keys: Set<string>, cast: Set<string>, facts: Record<string, string>, quests: Record<string, string>): string[] {
  const problems: string[] = [];
  const op: string = effect.op;
  if (!(op in EFFECT_OPS) && op !== START_FIGHT) return [`${op} isn't an effect the story knows`];
  for (const cond of [effect.if, effect.unless]) for (const fact of cond ? [cond.established].flat() : []) if (!(fact in facts)) problems.push(`condition on unknown fact ${fact}`);
  if (op === START_FIGHT) {
    // The fight's set-up (the Heron's combat exit), recorded for the fight to come: who's in it, where.
    const fight = effect as unknown as { enemies?: Array<{ leader?: string }>; allies?: string[]; at?: string };
    for (const who of [...(fight.allies ?? []), ...(fight.enemies ?? []).flatMap(e => e.leader ? [e.leader] : [])]) if (!cast.has(who)) problems.push(`startFight names unknown ${who}`);
    if (fight.at !== undefined && !keys.has(fight.at)) problems.push(`startFight is at unknown ${fight.at}`);
  } else if (effect.op === "attitude" || effect.op === "remember" || effect.op === "follow") {
    if (!cast.has(effect.who)) problems.push(`${effect.op} names unknown ${effect.who}`);
    if (effect.op === "attitude" && !ATTITUDES.includes(effect.to)) problems.push(`attitude ${String(effect.to)} isn't an attitude`);
  } else if (effect.op === "promise") {
    for (const who of [effect.by, effect.to]) if (who !== "$player" && !cast.has(who)) problems.push(`promise names unknown ${who}`);
  } else if (effect.op === "quest") {
    if (!(effect.quest in quests)) problems.push(`quest ${effect.quest} isn't one of campaign.json's quests`);
  } else if (effect.op !== "flag" && effect.op !== "journal") {
    for (const k of namedKeys(effect)) if (!keys.has(k)) problems.push(`${effect.op} names unknown ${k}`);
  }
  return problems;
}

/** Every op an effect may have (shared/scene/files.ts Effect): the story's, and the world's (WorldOp's). */
const EFFECT_OPS: Record<Effect["op"], true> = {
  quest: true, flag: true, attitude: true, remember: true, journal: true, follow: true, promise: true,
  move: true, place: true, give: true, drop: true, create: true, state: true, note: true, forget: true, remove: true,
  destroy: true, ignite: true, douse: true, spill: true, chill: true, bleed: true, break: true,
};
/** The fight's set-up, which the effects have no op for yet: recorded, as the prototype's startCombat was, for the fight to come (V12). */
const START_FIGHT = "startFight";
const ATTITUDES: string[] = ["hostile", "unfriendly", "wary", "neutral", "friendly", "devoted"];

/** The keys a world operation names (what it acts on, where it goes); "$player" is the controller's character. */
function namedKeys(op: { what?: string; to?: string }): string[] {
  return [op.what, op.to].filter((k): k is string => !!k && k !== "$player");
}

/**
 * The talk template (campaign.json's `talk`, town-design §3.6), held to the talk's own rules: a scene
 * whose companion is `{companion}`, its first cast entry whoever walks with the player (`{companion}`,
 * named `{name}`), its start with their opening role (the co-GM's first note), the discovery each
 * talk's prep fills with the one thing they might confide (TOLD), the ending saying goodbye or walking
 * on ends it at (GOODBYE) with a way into it from the start (so it's open all talk long), and no
 * place of its own; and everyone the story has walk with the player (a `follow` effect) has a lore
 * entry to be themselves from (the AI service builds their talks from it: a talk with someone who
 * hasn't is refused).
 */
function talkProblems(pack: CampaignPack, files: CampaignFiles): string[] {
  const key = pack.campaign.talk;
  if (key === undefined) return [];
  const template = pack.scenes.find(scene => scene.id === key);
  if (!template) return files[scenePath(key)] === undefined ? [`campaign.json: its talk template ${scenePath(key)} isn't there`] : [];
  const at = scenePath(key), problems: string[] = [];
  if (template.companion !== "{companion}") problems.push(`${at}: the talk template's companion is ${JSON.stringify(template.companion)}, not "{companion}"`);
  const [first] = template.cast;
  if (first?.id !== "{companion}" || first.name !== "{name}") problems.push(`${at}: the talk template's first cast entry isn't the companion's ({companion}, named {name})`);
  const start = template.nodes.find(isStart);
  if (start && !start.data.cast?.["{companion}"]?.trim()) problems.push(`${at}: the talk template's start has no role for {companion} (their opening role, the co-GM's first note)`);
  const told = template.nodes.find(n => n.id === TOLD);
  if (!told || !isDiscovery(told)) problems.push(`${at}: the talk template has no discovery ${TOLD} (the one thing they might confide, which each talk's prep fills in)`);
  if (!template.nodes.some(n => n.id === GOODBYE && isEnding(n))) problems.push(`${at}: the talk template has no ending ${GOODBYE} (where saying goodbye or walking on ends a talk)`);
  else if (!template.edges.some(e => e.source === start?.id && e.target === GOODBYE)) problems.push(`${at}: the talk template has no way into ${GOODBYE} from its start (saying goodbye ends a talk wherever it's got to)`);
  if (template.place !== undefined) problems.push(`${at}: the talk template has a place (a talk is wherever the player stopped)`);
  const followers = new Set(pack.scenes.flatMap(scene => [...(scene.onEnd ?? []), ...scene.nodes.filter(isEnding).flatMap(n => n.data.effects ?? [])])
    .flatMap(e => (e.op === "follow" ? [e.who] : [])));
  const entries = new Set(Object.entries(files).filter(([path]) => path.startsWith("lore/") && path.endsWith("/private.md"))
    .map(([, text]) => /^character:\s*"?([^"\n]+)"?\s*$/m.exec(text)?.[1]).filter((id): id is string => !!id));
  for (const who of followers) if (!entries.has(who)) problems.push(`${at}: ${who} walks with the player, but has no lore entry to talk from (a private.md with character: ${who})`);
  return problems;
}

/**
 * The story between scenes (story-design §4.6): where the story goes when a scene is overtaken is a
 * scene of the campaign, and a scene that can be overtaken says what it assumes; an interlude
 * (downtime the story skips) has an ending that goes on; and each of the story's quests has a title.
 * (An ending's next is each scene's own check.)
 */
function storyProblems(pack: CampaignPack): string[] {
  const scenes = new Set(pack.scenes.map(scene => scene.id));
  const problems: string[] = [];
  for (const scene of pack.scenes) {
    const at = scenePath(scene.id);
    if (scene.overtaken && !scenes.has(scene.overtaken)) problems.push(`${at}: overtaken, the story goes to ${scene.overtaken}, which isn't one of the campaign's scenes`);
    if (scene.assumes?.length && !scene.overtaken) problems.push(`${at}: it assumes things, but doesn't say where the story goes when play has overtaken them (overtaken)`);
    if (scene.overtaken && !scene.assumes?.length) problems.push(`${at}: it says where the story goes when it's overtaken, but assumes nothing that play could overtake`);
    if (scene.interlude && !scene.nodes.filter(isEnding).some(n => n.data.next)) problems.push(`${at}: an interlude, but none of its endings goes on (the story skips it to where they go)`);
  }
  for (const [key, title] of Object.entries(pack.campaign.quests ?? {})) if (typeof title !== "string" || !title.trim()) problems.push(`campaign.json: quest ${key} has no title`);
  return problems;
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

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
