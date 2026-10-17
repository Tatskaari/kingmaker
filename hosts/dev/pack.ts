import type { MapFile } from "../../shared/map/tiles.ts";
import type { BuildsFile, CampaignFile, CampaignPack, LooksFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";

/**
 * A campaign folder's files in memory, and the structure install_campaign takes from them (v0-design
 * §8). Nothing here touches Node: a host with no file system (the page's server worker) installs
 * from files it was handed, as the install tool does from the folder it reads (campaign.ts).
 */

/** A campaign folder's files by path ("scenes/hanged-clerk/setting.md"): every file, dotfiles left out. */
export type CampaignFiles = Record<string, string>;

/**
 * The structure install_campaign takes: campaign.json, each listed scene's scene.json with its hook
 * (hook.md, as the loader reads it), and after them the talk template's (campaign.json's `talk`: a
 * scene def the simulation fills for whoever walks with the player, town-design §3.6, though it isn't
 * on the story's way), each listed place, the builds, the looks and each listed map. Throws when a
 * file it needs is missing or isn't JSON.
 */
export function packOf(files: CampaignFiles): CampaignPack {
  const campaign = json<CampaignFile>(files, "campaign.json");
  return {
    campaign,
    scenes: [...campaign.scenes, ...(campaign.talk ? [campaign.talk] : [])]
      .map(key => ({ scene: json<SceneFile>(files, `scenes/${key}/scene.json`), hook: text(files, `scenes/${key}/hook.md`).trim() })),
    places: campaign.places.map(key => json<PlaceFile>(files, `places/${key}.json`)),
    builds: json<BuildsFile>(files, "builds.json"),
    looks: json<LooksFile>(files, "looks.json"),
    maps: (campaign.maps ?? []).map(key => json<MapFile>(files, `maps/${key}.json`)),
  };
}

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
