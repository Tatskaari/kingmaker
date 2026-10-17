// K's stand-in for the town unit (v2/docs/town-design.md §2, §3.3): package S copies the prototype's src/game/menu.ts at 44c6d4a here, lines 1-476 (the map's geometry, aiming, the menu and its QA text) and 891-896 (mapWhy): the half both sides run. Its context is MenuCtx (the ExploreState from rows, the sheet's catalogue, the explore row's keep), not the game and the session, so it loads no engine: youHurt and cureFor read Catalogue.you, areaPlacement is shared/rules/aim.ts's. Doing it is shared/map/menu-acts.ts's. The types and signatures below are the copy's (aimedAt's Aimed and areaReach exported); isMenuAct is its own already.
import type { Aim, Catalogue, Entry, Section } from "../rules/aim.ts";
import type { Entity } from "../world/scene-world.ts";
import type { ExploreState } from "./explore.ts";
import type { TownWorld, Waiting } from "./town-world.ts";
import type { MapActor, StoryState, Tile2, TileMap } from "./types.ts";

/**
 * The action menu on the map (the app's m): what the player can do there, grouped by kind (the
 * rules' catalogue, from the sheet row), with what's in reach for each; aiming (who and what an entry
 * can be aimed at from here, how far it reaches, what an area would catch); and its ids, the
 * prototype's (menu.ts's header): cast_<spell>, cast_<spell>_self, cast_<spell>@x,y; the same for
 * feature_<id>; attack@x,y, throw@x,y, shove@x,y, grapple@x,y, lift@x,y, jump@x,y; hide; rest_short,
 * rest_short_recover, rest_long; use_<item>. The client offers and greys out by these checks, and the
 * simulation refuses by the same ones (town-design §3.2's refusal codes, in their words).
 */

/** When the player last rested, by the story's clock: once each before the clock moves on (the explore row's `rested`). */
export interface Rested { time: StoryState["time"]; short?: boolean; long?: boolean }

/** Where the player was seen trying to hide, and by whom (by the story's clock): not again from there (`spotted`). */
export interface Spotted { time: StoryState["time"]; at: Tile2; by: string }

/** Whose pockets the player has tried, by the story's clock (`lifted`). */
export interface Lifted { time: StoryState["time"]; who: string[] }

/** What the explorer keeps between acts, for the menu (the prototype's Ctx.keep): the explore row's. */
export interface Keep { rested?: Rested; spotted?: Spotted; lifted?: Lifted }

/**
 * What the menu reads (the prototype's Ctx, less the game and the session): the ExploreState made
 * from rows (shared/map/rows.ts exploreOf, the town's changes in its overlay), the rules' catalogue
 * (the sheet row's `actions`; undefined without a rules character, or before the menu), and the keep.
 */
export interface MenuCtx { ex: ExploreState; catalogue: Catalogue | undefined; keep: Keep }

/** Someone or something of a place whose scene is still to come: the scene's to play. `id` is theirs in the scene's world. */
export type Story = { kind: "waiting"; at: Tile2; name: string } & Pick<Waiting, "id" | "sceneId" | "person" | "live">;

/** Who or what is at a tile, as the menu aims at it. */
export type Aimed =
  | { kind: "self"; at: Tile2; name: "you" }
  | { kind: "being"; at: Tile2; name: string; entity: Entity; companion: boolean }
  | { kind: "thing"; at: Tile2; name: string; entity: Entity }
  | Story;

export interface MenuItem extends Entry {
  /** Ready to do as it is (nothing to aim, or aimed already): its action id. */
  id?: string;
  /** Wants aiming on the map first. */
  aiming?: boolean;
}

export interface MenuView {
  title: string;
  sections: Array<Omit<Section, "entries"> & { entries: MenuItem[] }>;
  /** Aimed at a tile already (a right-click's "Do something…"). */
  at?: Tile2;
}

export interface AimAt {
  ok: boolean;
  /** Why not, when it isn't. */
  why?: string;
  /** The action id to do it with. */
  id?: string;
  /** "Fire Bolt (cantrip) at the cabbage cart", for the hint line. */
  label: string;
  /** What's aimed at, in a few words ("the cabbage cart", "yourself", "the market square"). */
  target?: string;
  /** More on how it goes, for the hint line: a leap's "over a cabbage cart", "Athletics, DC 12". */
  note?: string;
  /** The tiles an area covers, aimed here. */
  area?: Tile2[];
  /** Who and what that area catches (you included). */
  caught?: string[];
  feet: number;
}

export interface AimView {
  entry: Entry;
  /** Where its reach ends: a ring of tiles round the player. */
  ring: Tile2[];
  /** Who and what it could be aimed at from here (in reach, in sight), nearest first: Tab goes through them. */
  targets: Array<{ at: Tile2; name: string; id: string }>;
  /** It can be aimed at yourself. */
  self: boolean;
  /** Aimed at yourself, it would be done now (a heal needs you hurt). */
  selfReady: boolean;
  /** Where the aim starts: the nearest target, and for an area the nearest whose area leaves you out; undefined with nothing in reach. */
  start?: Tile2;
}

const notBuilt = (what: string) => new Error(`not built: shared/map/menu.ts ${what} is package S's (town-design §2)`);

/** Does anything stand in the way of a spell or a shot between two tiles (walls, buildings, trees, shut doors)? The ends don't count. */
export function clearLine(_map: TileMap, _actors: MapActor[], _a: Tile2, _b: Tile2): boolean {
  throw notBuilt("clearLine");
}

/** Somewhere a body can land or stand: open ground (or water, or a doorway that's open), nobody in the way, not a way off the map. */
export function standable(_map: TileMap, _actors: MapActor[], _p: Tile2, _story: StoryState): boolean {
  throw notBuilt("standable");
}

/**
 * Can an entry be aimed at a tile from where the player stands, and what would it do there?
 * `area`: work out what an area covers and catches (what the aim on screen shows; a list of targets
 * needn't). menu.ts:248.
 */
export function checkAim(_c: MenuCtx, _tw: TownWorld, _entry: Entry, _at: Tile2, _options: { area?: boolean } = {}): AimAt {
  throw notBuilt("checkAim");
}

/**
 * What an area aimed at a tile reaches, as the rules will have it: castSpell's own placement and its
 * own test of what's inside. `tiles`: the tiles whose middles it covers, and who and what it catches
 * by name, you first; `scene`: what of a scene still to come it reaches. menu.ts:332.
 */
export function areaReach(_tw: TownWorld, _ex: ExploreState, _aim: Extract<Aim, { kind: "area" }>, _at: Tile2, _where: Aimed | undefined, _tiles: boolean): { tiles?: Tile2[]; caught?: string[]; scene: Waiting[] } {
  throw notBuilt("areaReach");
}

/** What an entry can be aimed at from here: its reach, and the targets in it. menu.ts:382. */
export function aimView(_c: MenuCtx, _tw: TownWorld, _entry: Entry): AimView {
  throw notBuilt("aimView");
}

/** The menu now: what the player can do, by kind, and what's in reach for each. `at`: aimed at a tile already. menu.ts:421. */
export function menuOf(_c: MenuCtx, _at?: Tile2): MenuView | undefined {
  throw notBuilt("menuOf");
}

/** The menu as a QA observation says it: each kind, what's in it, the ids to act with (or why not). menu.ts:457. */
export function menuText(_c: MenuCtx): string {
  throw notBuilt("menuText");
}

/** Why the map won't do an entry now, whatever the rules say: you've been seen trying to hide here. menu.ts:891. */
export function mapWhy(_c: MenuCtx, _entry: Entry): string | undefined {
  throw notBuilt("mapWhy");
}

const STEM = /^(cast|feature)_(.+?)(?:_(self)|@(\d+),(\d+))?$/;
const BLOW = /^(attack|throw|shove|grapple|jump|lift)@(\d+),(\d+)$/;

/** Is this one of the menu's action ids? (menu.ts:479-483) */
export const isMenuAct = (id: string) => STEM.test(id) || BLOW.test(id) || /^(hide|rest_short|rest_short_recover|rest_long)$/.test(id) || /^use_.+$/.test(id);
