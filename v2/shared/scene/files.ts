import type { CreationWorld } from "../creation/types.ts";
import type { Build } from "../rules/types.ts";
import type { Skill } from "./types.ts";
import type { WorldOp, WorldSpec } from "../world/scene-world.ts";
import type { MapFile } from "../map/tiles.ts";

/**
 * The campaign format: the files of a campaign folder (v2/campaigns/<id>/), as content-world A1-A4
 * has them. JSON holds the structure and its short logic text (a route's `when`, a check's lines,
 * the fact sentences); the prose is Markdown beside it, read by scene/load.ts. Object key order is
 * meaningful (beats, exits and essentials are in the prototype's order), and JSON.parse keeps it.
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
   * player starts walking (a map's key and a tile on it: v2/docs/map-design.md §3.3). With no map,
   * the first scene opens at once.
   */
  start: { day: number; time: TimeOfDay; map?: string; at?: [number, number] };
  /** The level a character starts at. */
  level: number;
  rulesPack: string;
  scenes: string[];
  places: string[];
  /** The maps the story is walked on (maps/<key>.json), if it has any. */
  maps?: string[];
  /** Coin the player starts with, given at the first scene. */
  startingPurse: Array<{ name: string; quantity: number; description: string }>;
  /** The world a backstory is written for and checked against, at character creation (v1-design §3.9). */
  creation: CreationWorld;
}

export type Phase = "attempt" | "cue" | "outcome";

/** A route: an entry in a beat's `routes` or the scene's `anytime`. Fact ids, not their sentences. */
export interface RouteFile {
  id: string;
  on: Phase;
  when: string;
  to?: string;
  check?: {
    skill: Skill; dc: number; reason?: string; success: string; failure: string;
    onSuccess: string; onFailure?: string; establishes?: { success?: string[]; failure?: string[] };
  };
  establishes?: string[];
  given?: true;
  essential?: string;
  towards?: string;
}

/** A cast entry: the structure, with the card (`cast/<id>.md`) holding the words. */
export interface CastFile {
  id: string; name: string;
  /** The card's path in the scene's folder. */
  card: string;
  called?: string; aka?: string[]; enters?: string; group?: string; statblock?: string; weapon?: string;
  members?: Array<{ id: string; name: string; statblock?: string; weapon?: string; look?: string }>;
}

/** A condition on established facts (fact ids). */
export type Cond = { if?: { established: string }; unless?: { established: string } };

/** A world operation as data: any of WorldOp's fields, `$player` naming the controller's character. */
export type WorldOpData = Pick<WorldOp, "op"> & Partial<Omit<WorldOp, "op">>;

/** What an exit does to the story and the world (the prototype's exit scripts, as data: content-world A6). */
export type Effect = Cond & (
  | { op: "quest"; quest: string; do: "start" | "advance" | "complete" | "fail"; title?: string; stage?: string; text: string }
  | { op: "flag"; name: string; value: string }
  | { op: "attitude"; who: string; to: "hostile" | "unfriendly" | "wary" | "neutral" | "friendly" | "devoted"; text: string }
  | { op: "remember"; who: string; text: string }
  | { op: "journal"; text: string }
  | WorldOpData
);

/** scenes/<id>/scene.json. */
export interface SceneFile {
  id: string; title: string; summary: string;
  kind: "scene" | "talk";
  time?: TimeOfDay;
  /** The place's key: places/<key>.json. */
  place?: string;
  start: string;
  cast: CastFile[];
  /** Fact id → the sentence the GM is told. */
  facts: Record<string, string>;
  beats: Record<string, { title: string; text: string; routes: RouteFile[] }>;
  anytime: RouteFile[];
  exits: Record<string, { kind: "combat" | "persuaded" | "progress" | "leave" | "other"; title: string; next?: string; text: string; effects: Effect[] }>;
  essentials: Record<string, { what: string; placedWith: string[]; carriers?: string[]; unlocks: string; later?: string; things?: string[]; missed?: string }>;
  /** World operations applied as the scene ends (not on a combat exit), each on something. */
  afterwards: Array<Pick<WorldOp, "op" | "what"> & Partial<WorldOp>>;
  lore: string[];
  fronts?: string;
}

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

/** A scene as install_campaign takes it: its scene.json, and its hook (hook.md), which the simulation shows and finds names in. */
export interface SceneInstall { scene: SceneFile; hook: string }

/** The campaign's structure, as the simulation installs it: no Markdown but the hooks. */
export interface CampaignPack {
  campaign: CampaignFile;
  scenes: SceneInstall[];
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

/** install_campaign's arguments as a pack (the simulation's side). Throws on JSON that doesn't parse. */
export function packOf(args: InstallArgs): CampaignPack {
  return {
    campaign: JSON.parse(args.campaign) as CampaignFile, scenes: JSON.parse(args.scenes) as SceneInstall[], places: JSON.parse(args.places) as PlaceFile[],
    builds: JSON.parse(args.builds) as BuildsFile, looks: JSON.parse(args.looks) as LooksFile, maps: JSON.parse(args.maps) as MapFile[],
  };
}
