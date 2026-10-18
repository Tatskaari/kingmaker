import { configureDocs, type DocsVolume } from "../docs/config.ts";
import { isAbsolute, normalize } from "../docs/paths.ts";
import { isDoc } from "../docs/volumes.ts";
import { storyOf, VOCABULARY, vocabularyOf, type Story, type Vocabulary } from "../gm/story.ts";
import { talkScene } from "../gm/talk.ts";
import type { CreationWorld } from "../../shared/creation/types.ts";
import type { CampaignPutAnswer } from "../../shared/protocol/ai.ts";
import { parseScene, SCENE_EXTENSION } from "../../shared/scene/document.ts";
import type { CampaignFile } from "../../shared/scene/files.ts";
import { FormatError, loadPlace, loadScenario, placePath, scenarioPath } from "../../shared/scene/scenario.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import { talkOf } from "../../shared/scene/talk.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { Failure } from "./context.ts";
import type { CampaignStore, DocsStore, VersionFiles } from "./stores.ts";

/**
 * The campaigns the AI service has the words of (v0-design §8): each version as the install tool PUT
 * it, the whole folder, since the GM needs the graph as well as the prose. A request names its game's
 * version, and gets each scene with its words, and the world a backstory is written for (the scenario's
 * `creation`, v1-design §3.9: <campaign>.kmscenario, docs/scenario-format.md). A version never changes once installed (a release bumps it), so its
 * scenes are kept once read: the one cache of a game's content the service allows.
 *
 * The docs service reads each game's lore from its own campaign's version (docs/combat-gm.md: the
 * zoo served beside the story), so a service serves every version installed: a request sets its
 * game's lore, and what's read with no game (character creation's world, the cast's entries) is the
 * version the latest request or PUT named. (V0's served one version, and refused another with 409.)
 */

/** An installed campaign version, as the endpoints read it. */
export interface Campaign {
  id: string;
  version: string;
  /** "Caerwyn": what anyone there knows, in the GM's note of what the player knows. */
  title: string;
  /** The world a backstory is written for and checked against, at character creation. */
  creation: CreationWorld;
  /**
   * A scene as authored, with its words; or a talk's ("talk-kell-2", town-design §3.6), the campaign's
   * talk template filled for the companion, with their lore's look and voice (gm/talk.ts talkScene).
   * Throws a 400 for a scene the campaign hasn't got, or a talk with someone who has no lore entry.
   */
  scene(key: string): Scene;
  /** The story its scenes belong to: those it installs, and its vocabulary.json for the rest (gm/story.ts). */
  story: Story;
}

export interface Campaigns {
  /** A version installed from its files (PUT), every scene loaded with its words first. */
  put(campaign: string, version: string, files: Record<string, string>): Promise<CampaignPutAnswer>;
  /** The version a request names, with the docs service pointed at its lore, the game's own when it's named (400 not installed). */
  use(campaign: string, version: string, game?: string): Campaign;
  /** The installed versions, "caerwyn@0.1.0". */
  list(): string[];
}

export function campaigns(store: CampaignStore, docs: DocsStore): Campaigns {
  const read = new Map<string, Campaign>();
  const lores = new Map<string, DocsVolume>();
  let serving: string | undefined;

  /** The docs service's lore: this version's lore/ (the game's, when it's named), and each game's copy in the docs store. */
  const serve = (campaign: string, version: string, files: VersionFiles, game?: string) => {
    const id = `${campaign}@${version}`;
    const lore = lores.get(id) ?? loreOf(files);
    lores.set(id, lore);
    if (game) configureDocs({ gameLore: { game, lore } });
    if (serving === id) return;
    configureDocs({ lore, overlay: game => docs.overlay(game) });
    serving = id;
  };

  return {
    async put(campaign, version, files) {
      checkNames(campaign, version);
      checkPaths(files);
      const file = campaignFileOf(files, campaign, version);
      checkCreation(file.creation);
      const scenes = file.scenes.map(key => sceneFrom(key, path => files[path]));
      // The talk template loads with its words too, its placeholders as they are (town-design §3.6).
      if (file.talk) sceneFrom(file.talk, path => files[path]);
      checkVocabulary(files);

      await store.put(campaign, version, files);
      read.delete(`${campaign}@${version}`);
      lores.delete(`${campaign}@${version}`);
      serve(campaign, version, store.files(campaign, version)!);

      return { campaign, version, files: Object.keys(files).length, scenes: scenes.map(s => s.id) };
    },

    use(campaign, version, game) {
      checkNames(campaign, version);
      const files = store.files(campaign, version);
      if (!files) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} isn't installed here: PUT /v1/campaigns/${campaign}/${version} first`);
      serve(campaign, version, files, game);

      const id = `${campaign}@${version}`;
      const cached = read.get(id) ?? campaignAt(files, campaign, version);
      read.set(id, cached);
      return cached;
    },

    list: () => store.list(),
  };
}

/** A version's lore/, as the docs service reads the authored lore: read only. */
function loreOf(files: VersionFiles): DocsVolume {
  return {
    read: path => files.read(`lore/${path}`),
    write: path => { throw new Error(`the authored lore is read only: ${path}`); },
    list: () => files.paths().filter(path => path.startsWith("lore/")).map(path => path.slice("lore/".length)).filter(isDoc),
  };
}

/** An installed version: its scenario now, each scene (or talk) when it's first asked for, the story when it's first read. */
function campaignAt(files: VersionFiles, campaign: string, version: string): Campaign {
  const file = loadScenario(files.read(scenarioPath(campaign))!, scenarioPath(campaign));
  const scenes = new Map<string, Scene>();
  const words = (path: string) => files.read(path);
  const scene = (key: string): Scene => {
    const talk = file.talk !== undefined && !file.scenes.includes(key) ? talkOf(key) : undefined;
    if (!talk && !file.scenes.includes(key)) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} has no scene ${key}`);
    const loaded = scenes.get(key) ?? (talk ? talkFrom(key, talk.companion) : sceneFrom(key, words));
    scenes.set(key, loaded);
    return loaded;
  };
  // A talk: the template filled for the companion, their statblock and weapon from their card in the
  // first of the story's scenes that has them (the prototype's castCard).
  const talkFrom = (key: string, companion: string): Scene => {
    const path = scenePath(file.talk!);
    let built: Scene | undefined;
    try {
      const template = parseScene(words(path) ?? "", path);
      built = talkScene(key, template, id => file.scenes.map(scene).flatMap(s => s.cast).find(c => c.id === id));
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure(400, "bad_request", `the talk template ${file.talk} doesn't load: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!built) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} has no talk ${key}: ${companion} has no lore entry to talk from`);
    return built;
  };
  let story: Story | undefined;
  return {
    id: campaign, version, title: file.title, creation: file.creation, scene,
    get story() {
      return (story ??= storyOf(`${campaign}@${version}`, { keys: file.scenes, scene: key => ({ ...scene(key), ...placeOf(key, words) }) }, storedVocabulary(words)));
    },
  };
}

/** Where a campaign keeps a scene's file: scenes/<id>.kmscene. */
const scenePath = (key: string) => `scenes/${key}${SCENE_EXTENSION}`;

/** A scene's place as its world (what the story reads of a scene it doesn't play: its places' names), from the place the scene file names (places/<key>.kmplace). */
function placeOf(key: string, read: (path: string) => string | undefined): Pick<Scene, "world"> {
  const place = (JSON.parse(read(scenePath(key)) ?? "{}") as { place?: string }).place;
  const path = place === undefined ? undefined : placePath(place);
  const text = path === undefined ? undefined : read(path);
  if (path === undefined || text === undefined) return {};
  const { key: _, ...world } = loadPlace(text, path);
  return { world };
}

/**
 * vocabulary.json, or none (a campaign without one vets its lines against its own scenes alone). The
 * PUT refused one that doesn't read, so this throws only for a folder written some other way.
 */
function storedVocabulary(read: (path: string) => string | undefined): Vocabulary {
  const text = read(VOCABULARY);
  if (text === undefined) return { source: "", scenes: [] };
  const vocabulary = vocabularyOf(text);
  if (Array.isArray(vocabulary)) throw new Error(`the installed ${VOCABULARY} doesn't read: ${briefly(vocabulary)}`);
  return vocabulary;
}

/** The PUT's vocabulary.json, if it has one, reads as the story will read it: a 400 when it doesn't, as for a scene that doesn't load. */
function checkVocabulary(files: Record<string, string>): void {
  const text = files[VOCABULARY];
  const vocabulary = text === undefined ? undefined : vocabularyOf(text);
  if (Array.isArray(vocabulary)) throw new Failure(400, "bad_request", briefly(vocabulary));
}

/** A list of problems as one message: the first three, and how many more. */
const briefly = (problems: string[]) => `${problems.slice(0, 3).join("; ")}${problems.length > 3 ? `; and ${problems.length - 3} more` : ""}`;

/** A scene with its words, from its file (scenes/<id>.kmscene, by its path in the campaign): a 400 when it doesn't load. */
function sceneFrom(key: string, read: (path: string) => string | undefined): Scene {
  try {
    const text = read(scenePath(key));
    if (text === undefined) throw new Error(`no ${scenePath(key)}`);
    return sceneOf(parseScene(text, scenePath(key)));
  } catch (error) {
    throw new Failure(400, "bad_request", `scene ${key} doesn't load: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The PUT's scenario (<campaign>.kmscenario, docs/scenario-format.md), as the game keeps it: held to the
 * format's shape, its id and campaign version the PUT's. What the service reads of it: its title, its
 * scenes' keys, the talk template's, and the world a backstory is written for.
 */
function campaignFileOf(files: Record<string, string>, campaign: string, version: string): CampaignFile {
  const path = scenarioPath(campaign);
  const text = files[path];
  if (text === undefined) throw new Failure(400, "bad_request", `the files have no ${path}`);
  let file: CampaignFile;
  try {
    file = loadScenario(text, path);
  } catch (error) {
    // A FormatError's message names the file and what's wrong with it.
    throw new Failure(400, "bad_request", error instanceof FormatError ? error.message : `${path}: ${String(error)}`);
  }
  if (file.id !== campaign || file.version !== version) throw new Failure(400, "bad_request", `${path} is ${file.id}@${file.version}, not ${campaign}@${version}`);
  return file;
}

/** The creation block as the backstory's calls read it: a 400 for one that isn't, or whose places' words aren't regular expressions. */
function checkCreation(world: CreationWorld | undefined): void {
  const strings = (list: unknown) => Array.isArray(list) && list.every(x => typeof x === "string");
  const compiles = (words: unknown) => { try { return typeof words === "string" && !!new RegExp(words, "i"); } catch { return false; } };
  const fits = !!world && typeof world.name === "string" && typeof world.premise === "string" && typeof world.primer === "string" && strings(world.notCanon)
    && Array.isArray(world.places) && world.places.every(p => typeof p?.doc === "string" && compiles(p.words));
  if (!fits) throw new Failure(400, "bad_request", "the scenario's creation isn't { name, premise, primer, notCanon: [doc], places: [{ doc, words }] }, each place's words a regular expression");
}

/** A campaign's and a version's names make folders: letters, digits, dots, dashes and underscores. */
function checkNames(campaign: string, version: string): void {
  for (const name of [campaign, version]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name.includes("..")) throw new Failure(400, "bad_request", `"${name}" isn't a campaign or version name`);
  }
}

/** Every path is the campaign folder's own: relative, normal, never climbing out of it. */
function checkPaths(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const plain = !!path && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0") && normalize(path) === path && !path.split("/").some(part => part === "..");
    if (!plain) throw new Failure(400, "bad_request", `"${path}" isn't a path in the campaign's folder`);
    if (typeof text !== "string") throw new Failure(400, "bad_request", `${path}: a file's text must be a string`);
  }
}
