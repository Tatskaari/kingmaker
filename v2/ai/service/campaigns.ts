import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { storyOf, type Story, type Vocabulary } from "../gm/story.ts";
import type { CampaignPutAnswer } from "../../shared/protocol/ai.ts";
import type { CampaignFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { Failure } from "./context.ts";
import type { CampaignStore } from "./stores.ts";

/**
 * The campaigns the AI service has the words of (v0-design §8): each version as the install tool PUT
 * it, the whole folder, since the GM needs the graph as well as the prose. A request names its game's
 * version, and gets each scene with its words. A version never changes once installed (a release
 * bumps it), so its scenes are kept once read: the one cache of a game's content the service allows.
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

export function campaigns(store: CampaignStore, docsRoot: string): Campaigns {
  const read = new Map<string, Campaign>();
  let serving: string | undefined;

  /** The docs service's lore root, set once: this version's lore, and each game's copy under docsRoot. */
  const serve = (campaign: string, version: string, root: string) => {
    const id = `${campaign}@${version}`;
    if (serving === id) return;
    configureDocs({ loreRoot: join(root, "lore"), overlay: game => join(docsRoot, game, "docs") });
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
      const scenes = file.scenes.map(key => sceneFrom(key, path => files[path]));
      refuseOther(campaign, version);

      await store.put(campaign, version, files);
      read.delete(`${campaign}@${version}`);
      serve(campaign, version, store.root(campaign, version)!);

      return { campaign, version, files: Object.keys(files).length, scenes: scenes.map(s => s.id) };
    },

    use(campaign, version) {
      checkNames(campaign, version);
      const root = store.root(campaign, version);
      if (!root) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} isn't installed here: PUT /v1/campaigns/${campaign}/${version} first`);
      refuseOther(campaign, version);
      serve(campaign, version, root);

      const id = `${campaign}@${version}`;
      const cached = read.get(id) ?? campaignAt(root, campaign, version);
      read.set(id, cached);
      return cached;
    },

    list: () => store.list(),
  };
}

/** A version on disk: its campaign.json now, each scene when it's first asked for, the story when it's first read. */
function campaignAt(root: string, campaign: string, version: string): Campaign {
  const file = JSON.parse(readFileSync(join(root, "campaign.json"), "utf8")) as CampaignFile;
  const scenes = new Map<string, Scene>();
  const words = (path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined);
  const scene = (key: string): Scene => {
    if (!file.scenes.includes(key)) throw new Failure(400, "bad_request", `campaign ${campaign}@${version} has no scene ${key}`);
    const loaded = scenes.get(key) ?? sceneFrom(key, words);
    scenes.set(key, loaded);
    return loaded;
  };
  let story: Story | undefined;
  return {
    id: campaign, version, title: file.title, scene,
    get story() {
      return (story ??= storyOf(`${campaign}@${version}`, { keys: file.scenes, scene: key => ({ ...scene(key), ...placeOf(key, words) }) }, vocabularyOf(words)));
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

/** vocabulary.json, or none (a campaign without one vets its lines against its own scenes alone). */
function vocabularyOf(read: (path: string) => string | undefined): Vocabulary {
  const text = read("vocabulary.json");
  return text === undefined ? { source: "", scenes: [] } : JSON.parse(text) as Vocabulary;
}

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

function campaignFileOf(files: Record<string, string>, campaign: string, version: string): CampaignFile {
  const text = files["campaign.json"];
  if (text === undefined) throw new Failure(400, "bad_request", "the files have no campaign.json");
  let file: CampaignFile;
  try { file = JSON.parse(text) as CampaignFile; } catch { throw new Failure(400, "bad_request", "campaign.json isn't JSON"); }
  if (file.id !== campaign || file.version !== version) throw new Failure(400, "bad_request", `campaign.json is ${file.id}@${file.version}, not ${campaign}@${version}`);
  return file;
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
