import { configureDocs, type DocsVolume } from "../docs/config.ts";
import { isAbsolute, normalize } from "../docs/paths.ts";
import { isDoc } from "../docs/volumes.ts";
import { storyOf, VOCABULARY, vocabularyOf, type Story, type Vocabulary } from "../gm/story.ts";
import type { CreationWorld } from "../../shared/creation/types.ts";
import type { CampaignPutAnswer } from "../../shared/protocol/ai.ts";
import type { CampaignFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { Failure } from "./context.ts";
import type { CampaignStore, DocsStore, VersionFiles } from "./stores.ts";

/**
 * The campaigns the AI service has the words of (v0-design §8): each version as the install tool PUT
 * it, the whole folder, since the GM needs the graph as well as the prose. A request names its game's
 * version, and gets each scene with its words, and the world a backstory is written for (campaign.json's
 * `creation`, v1-design §3.9). A version never changes once installed (a release bumps it), so its
 * scenes are kept once read: the one cache of a game's content the service allows.
 *
 * The docs service has one lore root per process, so V0's service serves one campaign version: the
 * first request or PUT sets it, and a request for another gets 409 other_campaign (restart the
 * service to serve a new version).
 */

/** An installed campaign version, as the endpoints read it. */
export interface Campaign {
  id: string;
  version: string;
  /** "Caerwyn": what anyone there knows, in the GM's note of what the player knows. */
  title: string;
  /** The world a backstory is written for and checked against, at character creation. */
  creation: CreationWorld;
  /** A scene as authored, with its words. Throws a 400 for a scene the campaign hasn't got. */
  scene(key: string): Scene;
  /** The story its scenes belong to: those it installs, and its vocabulary.json for the rest (gm/story.ts). */
  story: Story;
}

export interface Campaigns {
  /** A version installed from its files (PUT), every scene loaded with its words first. */
  put(campaign: string, version: string, files: Record<string, string>): Promise<CampaignPutAnswer>;
  /** The version a request names, with the docs service pointed at its lore (400 not installed, 409 another is served). */
  use(campaign: string, version: string): Campaign;
  /** The installed versions, "caerwyn@0.1.0". */
  list(): string[];
}

export function campaigns(store: CampaignStore, docs: DocsStore): Campaigns {
  const read = new Map<string, Campaign>();
  let serving: string | undefined;

  /** The docs service's lore, set once: this version's lore/, and each game's copy in the docs store. */
  const serve = (campaign: string, version: string, files: VersionFiles) => {
    const id = `${campaign}@${version}`;
    if (serving === id) return;
    configureDocs({ lore: loreOf(files), overlay: game => docs.overlay(game) });
    serving = id;
  };
  const refuseOther = (campaign: string, version: string) => {
    const id = `${campaign}@${version}`;
    if (serving && serving !== id) throw new Failure(409, "other_campaign", `this AI service serves ${serving}, not ${id}: restart it to serve another version`);
  };

  return {
    async put(campaign, version, files) {
      checkNames(campaign, version);
      checkPaths(files);
      const file = campaignFileOf(files, campaign, version);
      checkCreation(file.creation);
      const scenes = file.scenes.map(key => sceneFrom(key, path => files[path]));
      checkVocabulary(files);
      refuseOther(campaign, version);

      await store.put(campaign, version, files);
      read.delete(`${campaign}@${version}`);
      serve(campaign, version, store.files(campaign, version)!);

      return { campaign, version, files: Object.keys(files).length, scenes: scenes.map(s => s.id) };
    },

    use(campaign, version) {
      checkNames(campaign, version);
      const files = store.files(campaign, version);
      if (!files) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} isn't installed here: PUT /v1/campaigns/${campaign}/${version} first`);
      refuseOther(campaign, version);
      serve(campaign, version, files);

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

/** An installed version: its campaign.json now, each scene when it's first asked for, the story when it's first read. */
function campaignAt(files: VersionFiles, campaign: string, version: string): Campaign {
  const file = JSON.parse(files.read("campaign.json")!) as CampaignFile;
  const scenes = new Map<string, Scene>();
  const words = (path: string) => files.read(path);
  const scene = (key: string): Scene => {
    if (!file.scenes.includes(key)) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} has no scene ${key}`);
    const loaded = scenes.get(key) ?? sceneFrom(key, words);
    scenes.set(key, loaded);
    return loaded;
  };
  let story: Story | undefined;
  return {
    id: campaign, version, title: file.title, creation: file.creation, scene,
    get story() {
      return (story ??= storyOf(`${campaign}@${version}`, { keys: file.scenes, scene: key => ({ ...scene(key), ...placeOf(key, words) }) }, storedVocabulary(words)));
    },
  };
}

/** A scene's place as its world (what the story reads of a scene it doesn't play: its places' names), from the place the scene file names. */
function placeOf(key: string, read: (path: string) => string | undefined): Pick<Scene, "world"> {
  const place = (JSON.parse(read(`scenes/${key}/scene.json`) ?? "{}") as Partial<SceneFile>).place;
  const text = place === undefined ? undefined : read(`places/${place}.json`);
  if (text === undefined) return {};
  const { key: _, ...world } = JSON.parse(text) as PlaceFile;
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

/** A scene with its words, from its folder's files (by their paths in the campaign): a 400 when it doesn't load. */
function sceneFrom(key: string, read: (path: string) => string | undefined): Scene {
  try {
    const json = read(`scenes/${key}/scene.json`);
    if (json === undefined) throw new Error(`no scenes/${key}/scene.json`);
    return sceneOf(JSON.parse(json) as SceneFile, path => read(`scenes/${key}/${path}`));
  } catch (error) {
    throw new Failure(400, "bad_request", `scene ${key} doesn't load: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The PUT's campaign.json, with what the service reads of it: its id and version (the PUT's), its title and its scenes' keys. */
function campaignFileOf(files: Record<string, string>, campaign: string, version: string): CampaignFile {
  const text = files["campaign.json"];
  if (text === undefined) throw new Failure(400, "bad_request", "the files have no campaign.json");
  let file: CampaignFile;
  try { file = JSON.parse(text) as CampaignFile; } catch { throw new Failure(400, "bad_request", "campaign.json isn't JSON"); }
  if (!isCampaignFile(file)) throw new Failure(400, "bad_request", "campaign.json isn't a campaign's: it needs an id, a version, a title and a list of its scenes");
  if (file.id !== campaign || file.version !== version) throw new Failure(400, "bad_request", `campaign.json is ${file.id}@${file.version}, not ${campaign}@${version}`);
  return file;
}

function isCampaignFile(file: unknown): file is CampaignFile {
  const f = file as Partial<Record<keyof CampaignFile, unknown>> | null;
  return !!f && typeof f === "object" && !Array.isArray(f)
    && typeof f.id === "string" && typeof f.version === "string" && typeof f.title === "string"
    && Array.isArray(f.scenes) && f.scenes.every(key => typeof key === "string");
}

/** The creation block as the backstory's calls read it: a 400 for one that isn't, or whose places' words aren't regular expressions. */
function checkCreation(world: CreationWorld | undefined): void {
  const strings = (list: unknown) => Array.isArray(list) && list.every(x => typeof x === "string");
  const compiles = (words: unknown) => { try { return typeof words === "string" && !!new RegExp(words, "i"); } catch { return false; } };
  const fits = !!world && typeof world.name === "string" && typeof world.premise === "string" && typeof world.primer === "string" && strings(world.notCanon)
    && Array.isArray(world.places) && world.places.every(p => typeof p?.doc === "string" && compiles(p.words));
  if (!fits) throw new Failure(400, "bad_request", "campaign.json's creation isn't { name, premise, primer, notCanon: [doc], places: [{ doc, words }] }, each place's words a regular expression");
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
