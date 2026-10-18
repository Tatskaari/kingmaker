import { SCENE_EXTENSION, type SceneDocument } from "../../shared/scene/document.ts";
import type { BuildsFile, CampaignFile, CampaignPack, LooksFile } from "../../shared/scene/files.ts";
import { loadMap, loadPlace, loadScenario, mapPath, placePath, scenarioPathIn, SCENARIO_EXTENSION } from "../../shared/scene/scenario.ts";

/**
 * A campaign folder's files in memory, and the structure install_campaign takes from them (v0-design
 * §8). Nothing here touches Node: a host with no file system (the page's server worker) installs
 * from files it was handed, as the install tool does from the folder it reads (campaign.ts).
 */

/** A campaign folder's files by path ("scenes/hanged-clerk.kmscene"): every file, dotfiles left out. */
export type CampaignFiles = Record<string, string>;

/** Where a campaign keeps a scene's file: scenes/<id>.kmscene. */
export const scenePath = (key: string) => `scenes/${key}${SCENE_EXTENSION}`;

/** The folder's scenario file (<id>.kmscenario, its one at the root); throws when it has none, or several. */
export function scenarioPathOf(files: CampaignFiles): string {
  const path = scenarioPathIn(Object.keys(files));
  if (path) return path;
  const found = Object.keys(files).filter(p => !p.includes("/") && p.endsWith(SCENARIO_EXTENSION));
  throw new Error(found.length ? `the folder has ${found.length} scenarios (${found.join(", ")}), not one` : `the folder has no scenario (<id>${SCENARIO_EXTENSION})`);
}

/** The campaign as the game keeps it, from the folder's scenario (docs/scenario-format.md). Throws when it's missing or isn't one. */
export function campaignOf(files: CampaignFiles): CampaignFile {
  const path = scenarioPathOf(files);
  return loadScenario(files[path]!, path);
}

/**
 * What install_campaign takes: the campaign (its scenario), each listed scene's .kmscene file, and
 * after them the talk template's (the scenario's `talk`: a scene def the simulation fills for whoever
 * walks with the player, town-design §3.6, though it isn't on the story's way), each listed place
 * (places/<key>.kmplace), the builds, the looks and each listed map (maps/<key>.kmmap), the scenario,
 * the places and the maps as the game keeps them (scenario.ts asCampaignFile, asPlaceFile, asMapFile).
 * Throws when a file it needs is missing, or a scenario, place or map isn't of the format's shape; a
 * scene's shape is the campaign check's and the install's to hold it to (shared/scene/document.ts).
 */
export function packOf(files: CampaignFiles): CampaignPack {
  const campaign = campaignOf(files);
  return {
    campaign,
    scenes: [...campaign.scenes, ...(campaign.talk ? [campaign.talk] : [])].map(key => json<SceneDocument>(files, scenePath(key))),
    places: campaign.places.map(key => loadPlace(text(files, placePath(key)), placePath(key))),
    builds: json<BuildsFile>(files, "builds.json"),
    looks: json<LooksFile>(files, "looks.json"),
    maps: (campaign.maps ?? []).map(key => loadMap(text(files, mapPath(key)), mapPath(key))),
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
