import type { CreationWorld } from "../creation/types.ts";
import type { Build } from "../rules/types.ts";
import type { SceneDocument } from "./document.ts";
import type { WorldOp, WorldSpec } from "../world/scene-world.ts";
import type { MapFile } from "../map/tiles.ts";

/**
 * The campaign format: the files of a campaign folder (campaigns/<id>/), as content-world A1-A4 had
 * them and M2 changed them: campaign.json, each scene one .kmscene file (scenes/<id>.kmscene, the
 * scene format: document.ts, docs/scene-format.md), each place, map, the ready-made builds, the
 * cast's looks and the lore. Object key order is meaningful, and JSON.parse keeps it.
 */

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night" | "next-morning";

/** campaign.json. */
export interface CampaignFile {
  id: string;
  title: string;
  version: string;
  firstScene: string;
  startPlace: string;
  /**
   * When the story starts: the day and the time of day; and, for a campaign with maps, where the
   * player starts walking (a map's key and a tile on it: docs/map-design.md §3.3). With no map,
   * the first scene opens at once.
   */
  start: { day: number; time: TimeOfDay; map?: string; at?: [number, number] };
  /** The level a character starts at. */
  level: number;
  rulesPack: string;
  /** The story's scenes, by their ids (scenes/<id>.kmscene), the first one's first. */
  scenes: string[];
  places: string[];
  /** The maps the story is walked on (maps/<key>.json), if it has any. */
  maps?: string[];
  /** Coin the player starts with, given at the first scene. */
  startingPurse: Array<{ name: string; quantity: number; description: string }>;
  /** The world a backstory is written for and checked against, at character creation (v1-design §3.9). */
  creation: CreationWorld;
  /** The story's quests by key, each with its title: an exit's effect may advance one before any starts it (story-design §4.6). */
  quests?: Record<string, string>;
  /**
   * The talk template's id (town-design §3.6: "talk", scenes/talk.kmscene), a scene with `{name}` and
   * `{companion}` for whoever walks with the player (its `companion` "{companion}"): installed with the
   * scenes (its scene def's key is its id), never on the story's way (it isn't in `scenes`).
   */
  talk?: string;
}

/**
 * A condition on established facts (fact ids): `if`, every one of them established; `unless`, none
 * of them (story-design §4.2: two facts at once, or an "or" written as two effects).
 */
export type Cond = { if?: { established: string | string[] }; unless?: { established: string | string[] } };

/** A world operation as data: any of WorldOp's fields, `$player` naming the controller's character. */
export type WorldOpData = Pick<WorldOp, "op"> & Partial<Omit<WorldOp, "op">>;

/**
 * What an exit does to the story and the world (the prototype's exit scripts, as data: content-world
 * A6). Story-design §4.3: quest, flag, attitude, journal and follow write the story's rows; the rest
 * are recorded, as the prototype's recording world records every one.
 */
export type Effect = Cond & (
  | { op: "quest"; quest: string; do: "start" | "advance" | "complete" | "fail"; title?: string; stage?: string; text: string }
  | { op: "flag"; name: string; value: string }
  | { op: "attitude"; who: string; to: "hostile" | "unfriendly" | "wary" | "neutral" | "friendly" | "devoted"; text: string }
  | { op: "remember"; who: string; text: string }
  | { op: "journal"; text: string }
  /** Someone of the cast walks with the player between scenes, from now on (Kell, after the granary: the prototype's syncFollowers). */
  | { op: "follow"; who: string }
  /** A promise made, by whom to whom (the prototype's world.promise). */
  | { op: "promise"; by: string; to: string; text: string }
  | WorldOpData
);

/** places/<key>.json: the place as a world, as authored (the engine's defaults are applied when it's built). */
export type PlaceFile = { key: string } & WorldSpec;

/** One of builds.json's ready-made characters: who they are, and the build the rules engine makes them from (v1-design §3.9). */
export interface BuildFile {
  /** "a palace inspector with soft shoes, a rapier and a notebook, who reads people better than ledgers" */
  concept: string;
  build: Build;
}

/** builds.json: the ready-made characters, by id (cleric, fighter, ranger, rogue, wizard). */
export type BuildsFile = Record<string, BuildFile>;

/** looks.json: how the cast looks on screen, by cast id (Kell is a blue K). */
export type LooksFile = Record<string, { role: string; glyph: string; fg: string }>;

/** The campaign as the simulation installs it: everything but the lore (its scenes whole, with their words: what the two-part GM's commits read of them). */
export interface CampaignPack {
  campaign: CampaignFile;
  /** Each of the story's scenes, then the talk template's, as their .kmscene files have them. */
  scenes: SceneDocument[];
  places: PlaceFile[];
  builds: BuildsFile;
  looks: LooksFile;
  /** Its maps (campaign.json's `maps`), each as maps/<key>.json has it: none for a campaign without. */
  maps: MapFile[];
}

/** install_campaign's arguments: each part of a pack as a JSON string, and the version's id ("caerwyn@0.1.0"). */
export interface InstallArgs { id: string; campaign: string; scenes: string; places: string; builds: string; looks: string; maps: string }

/** A campaign version's id: "caerwyn@0.1.0". */
export const campaignId = (c: Pick<CampaignFile, "id" | "version">) => `${c.id}@${c.version}`;

/** A pack as install_campaign's arguments (the install tool's side). */
export function installArgsOf(pack: CampaignPack): InstallArgs {
  return {
    id: campaignId(pack.campaign),
    campaign: JSON.stringify(pack.campaign), scenes: JSON.stringify(pack.scenes), places: JSON.stringify(pack.places),
    builds: JSON.stringify(pack.builds), looks: JSON.stringify(pack.looks), maps: JSON.stringify(pack.maps),
  };
}

/** install_campaign's arguments as a pack (the simulation's side). Throws on JSON that doesn't parse; each scene's shape is the install's to check (document.ts). */
export function packOf(args: InstallArgs): CampaignPack {
  return {
    campaign: JSON.parse(args.campaign) as CampaignFile, scenes: JSON.parse(args.scenes) as SceneDocument[], places: JSON.parse(args.places) as PlaceFile[],
    builds: JSON.parse(args.builds) as BuildsFile, looks: JSON.parse(args.looks) as LooksFile, maps: JSON.parse(args.maps) as MapFile[],
  };
}
