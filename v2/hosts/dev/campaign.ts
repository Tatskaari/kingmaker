import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { BuildsFile, CampaignFile, CampaignPack, Effect, LooksFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import { SKILLS, validateScene, type Scene } from "../../shared/scene/types.ts";
import { VOCABULARY, vocabularyOf, vocabularyProblems } from "./vocabulary.ts";

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
 * (hook.md, as the loader reads it), each listed place, the builds and the looks. Throws when a file
 * it needs is missing or isn't JSON.
 */
export function packOf(files: CampaignFiles): CampaignPack {
  const campaign = json<CampaignFile>(files, "campaign.json");
  return {
    campaign,
    scenes: campaign.scenes.map(key => ({ scene: json<SceneFile>(files, `scenes/${key}/scene.json`), hook: text(files, `scenes/${key}/hook.md`).trim() })),
    places: campaign.places.map(key => json<PlaceFile>(files, `places/${key}.json`)),
    builds: json<BuildsFile>(files, "builds.json"),
    looks: json<LooksFile>(files, "looks.json"),
  };
}

/** What's wrong with a campaign, each problem a line naming where: [] when it's fit to install. */
export function checkCampaign(files: CampaignFiles): string[] {
  let pack: CampaignPack;
  try {
    pack = packOf(files);
  } catch (e) {
    return [(e as Error).message];
  }

  return [
    ...campaignProblems(pack),
    ...pack.scenes.flatMap(({ scene }) => sceneProblems(scene, files, pack)),
    ...pack.places.flatMap((place, i) => placeProblems(place, pack.campaign.places[i]!)),
    ...buildProblems(pack.builds),
    ...lookProblems(pack.looks, pack.scenes.flatMap(s => s.scene.cast.map(c => c.id))),
    ...vocabularyProblems(files, pack),
  ];
}

/**
 * A short account of a pack: "caerwyn 0.1.0: 1 scene (5 beats, 37 routes, 5 exits), 1 place, 154 lore
 * docs, 3 builds, 4 looks, the vocabulary of 25 scenes (44c6d4a)".
 */
export function describePack(pack: CampaignPack, files: CampaignFiles): string {
  const scenes = pack.scenes.map(({ scene }) => sceneOf(scene));
  const routes = scenes.reduce((n, s) => n + s.beats.reduce((m, b) => m + b.transitions.length, 0) + (s.anytime?.length ?? 0), 0);
  const beats = scenes.reduce((n, s) => n + s.beats.length, 0), exits = scenes.reduce((n, s) => n + s.exits.length, 0);
  const lore = Object.keys(files).filter(p => p.startsWith("lore/")).length;
  const vocabulary = files[VOCABULARY] === undefined ? undefined : vocabularyOf(files[VOCABULARY]);
  return `${pack.campaign.id} ${pack.campaign.version}: ${count(scenes.length, "scene")} (${count(beats, "beat")}, ${count(routes, "route")}, ${count(exits, "exit")}), `
    + `${count(pack.places.length, "place")}, ${count(lore, "lore doc")}, ${count(Object.keys(pack.builds).length, "build")}, ${count(Object.keys(pack.looks).length, "look")}`
    + (vocabulary && !Array.isArray(vocabulary) ? `, the vocabulary of ${count(vocabulary.scenes.length, "scene")} (${vocabulary.source})` : "");
}

// ---------------------------------------------------------------------------------------------
// The checks, a part of the pack each.

function campaignProblems(pack: CampaignPack): string[] {
  const c = pack.campaign, problems: string[] = [];
  for (const field of ["id", "title", "version", "firstScene", "startPlace"] as const) if (typeof c[field] !== "string" || !c[field]) problems.push(`campaign.json: no ${field}`);
  if (!c.scenes.includes(c.firstScene)) problems.push(`campaign.json: the first scene ${c.firstScene} isn't one of its scenes`);
  if (!c.places.includes(c.startPlace)) problems.push(`campaign.json: the start place ${c.startPlace} isn't one of its places`);
  if (!Number.isInteger(c.level) || c.level < 1) problems.push(`campaign.json: level ${c.level} isn't a level`);
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

/** The ready-made characters: a build line, a level, all 18 skills, a status line and the kit. */
function buildProblems(builds: BuildsFile): string[] {
  const problems: string[] = [];
  if (!Object.keys(builds).length) problems.push("builds.json: no builds");
  for (const [id, b] of Object.entries(builds)) {
    const at = `builds.json: ${id}`;
    if (typeof b.build !== "string" || !b.build) problems.push(`${at}: no build line`);
    if (!Number.isInteger(b.level)) problems.push(`${at}: no level`);
    if (typeof b.status !== "string") problems.push(`${at}: no status line`);
    const missing = SKILLS.filter(s => typeof b.skills?.[s] !== "number");
    if (missing.length) problems.push(`${at}: no ${missing.join(", ")} (a build has all 18 skills)`);
    for (const s of Object.keys(b.skills ?? {})) if (!(SKILLS as readonly string[]).includes(s)) problems.push(`${at}: unknown skill ${s}`);
    for (const g of b.gear ?? []) if (!g.id || !g.name || !GEAR_KINDS.includes(g.kind) || (g.slot && !SLOTS.includes(g.slot))) problems.push(`${at}: gear ${JSON.stringify(g)} isn't { id, name, kind, slot? }`);
  }
  return problems;
}

const GEAR_KINDS: string[] = ["weapon", "armor", "shield", "item"];
const SLOTS: string[] = ["mainHand", "offHand", "armor", "shield"];

/** The cast's looks: each names someone in a scene's cast, with a role, one glyph and a colour. */
function lookProblems(looks: LooksFile, castIds: string[]): string[] {
  return Object.entries(looks).flatMap(([id, look]) => [
    ...(castIds.includes(id) ? [] : [`looks.json: ${id} isn't in any scene's cast`]),
    ...(typeof look.role === "string" && look.role ? [] : [`looks.json: ${id} has no role`]),
    ...([...(look.glyph ?? "")].length === 1 ? [] : [`looks.json: ${id}'s glyph ${JSON.stringify(look.glyph)} isn't one character`]),
    ...(/^#[0-9a-f]{6}$/i.test(look.fg ?? "") ? [] : [`looks.json: ${id}'s colour ${JSON.stringify(look.fg)} isn't #rrggbb`]),
  ]);
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
