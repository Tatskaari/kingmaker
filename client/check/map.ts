// New: Caerwyn's map between scenes as its rows would give the client (map-design §3.3, §3.4, §3.6): the campaign's map files, the lane in the morning with the yard built on the map and its scene waiting (as the simulation's waitingPlace builds it), and the yard as its scene left it; for the screen check, the demo and the client's tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMap, useMaps } from "../../shared/map/maps.ts";
import { usePlaces } from "../../shared/map/places.ts";
import { feetToTile } from "../../shared/map/reconcile.ts";
import { exploreOf, type ExploreRow, type MapPlace, type MapRows } from "../../shared/map/rows.ts";
import type { MapFile } from "../../shared/map/tiles.ts";
import type { Unheard } from "../../shared/map/town.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { CampaignFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { worldToRows } from "../../shared/world/rows.ts";
import { buildWorld, joinWorld, type SceneWorld } from "../../shared/world/scene-world.ts";
import type { ExploreView } from "../explore/rows.ts";
import { YARD } from "./fixture.ts";
import { yardKeys, yardWorld, YARD_SCENE } from "./place.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(CAERWYN, path), "utf8")) as T;

/** Caerwyn's maps, as its campaign.json lists them: the json the map_def rows hold. */
export const CAERWYN_MAPS: MapFile[] = (read<CampaignFile>("campaign.json").maps ?? []).map(key => read<MapFile>(`maps/${key}.json`));

/** The yard's scene file: its cast, and what the player calls those whose names they haven't heard. */
const YARD_FILE = read<SceneFile>(`scenes/${YARD_SCENE}/scene.json`);

/** The cast the lead hasn't heard named on the map before the scene: the boy and the girl (Kell gives her name). */
export const UNHEARD: Unheard = YARD_FILE.cast.filter(c => c.called && !c.enters).map(c => ({ name: c.name, called: c.called! }));

/**
 * The maps and the yard's place file in use, as the simulation has them (useMaps, usePlaces): the
 * demo plays the simulation's part, and a scene's start on the map (enterScene) reads the place's.
 */
export function useCaerwyn(): void {
  useMaps(CAERWYN_MAPS);
  usePlaces([read<PlaceFile>("places/granary-yard.json")]);
}

/**
 * The yard as it waits for its scene (the simulation's world/place.ts waitingPlace): the place's
 * world with the cast present at the scene's start where its file puts them, and the lead's
 * character, who placed them, taken out with what they hold.
 */
export function waitingYard(name = "Pell Marrow"): SceneWorld {
  const present = YARD_FILE.cast.filter(c => !c.enters).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld(YARD_SCENE, read<PlaceFile>("places/granary-yard.json"), present, { name });
  joinWorld(world, present, 0);
  const theirs = (id: string | null): boolean => id === "player" || (!!id && !!world.entities[id] && theirs(world.entities[id]!.parent));
  for (const id of Object.keys(world.entities).filter(theirs)) delete world.entities[id];
  return world;
}

/** The yard's region on the town's map: where its world's (0, 0) feet sits. */
const YARD_ORIGIN: Tile2 = { x: 40, y: 9 };

/**
 * The yard on the town's map, as MapRows has it: its region and origin, its scene (waiting, being
 * played, or ended), and its world's rows with the cast's `called` names, as the simulation writes
 * them (the walker player 1).
 */
export function yardOnMap(world: SceneWorld, status: string): MapPlace {
  const rows = worldToRows(world, yardKeys(1n));
  const called = new Map(YARD_FILE.cast.filter(c => c.called).map(c => [c.id, c.called!]));
  rows.entity = rows.entity.map(e => (called.has(e.key) ? { ...e, called: called.get(e.key)! } : e));
  return { key: "granary-yard", mapKey: "caerwyn", region: "granary-yard", origin: YARD_ORIGIN, scene: { key: YARD_SCENE, status, time: "morning" }, rows };
}

/** The walker's explore row (player 1's, in game 1): on the town's map at a tile, facing south, as the simulation starts it. */
export function exploreRow(at: Tile2 = { x: 42, y: 9 }, patch: Partial<ExploreRow> = {}): ExploreRow {
  return { playerId: "1", gameId: "1", map: "caerwyn", at, facing: { x: 0, y: 1 }, steps: 0, hidden: false, followers: [], quips: 0, styles: [], acts: 0, said: "", log: [], ...patch };
}

/** The lane in the morning (map-design §1, row 1): the walker by the granary gate, the yard built and its scene waiting. */
export function laneRows(explore: ExploreRow = exploreRow()): MapRows {
  return { maps: CAERWYN_MAPS, explore, story: { time: "morning", lead: YARD_SCENE, played: [] }, places: [yardOnMap(waitingYard(), "waiting")], unheard: UNHEARD };
}

/**
 * The map after the scene (§1, row 7): the yard as the scene left it (`world`, the lead's character
 * in it), its scene ended; the walker where the scene left them, in the yard (Kell, who walks with
 * them now, beside them: exploreOf syncs her).
 */
export function afterRows(world: SceneWorld = yardWorld()): MapRows {
  useCaerwyn();
  const region = getMap("caerwyn").regions.find(r => r.id === "granary-yard")!;
  const feet = world.entities.player?.at;
  const at = feet ? feetToTile(region, feet) : { x: 43, y: 13 };
  return { maps: CAERWYN_MAPS, explore: exploreRow(at, { acts: 3, log: ["You come into the yard behind the King's Granary."] }), story: { time: "morning", lead: YARD_SCENE, played: [YARD_SCENE] }, places: [yardOnMap(world, "ended")], unheard: UNHEARD };
}

/** The explore view of some map rows, as the client makes it (explore/rows.ts): Pell Marrow's game 1, the lead's title and hook the yard's. */
export function mapView(rows: MapRows, patch: Partial<ExploreView> = {}): ExploreView {
  return {
    game: "1", ex: exploreOf(rows), unheard: rows.unheard,
    player: { name: "Pell Marrow", status: YARD.player.status!, build: "human wizard 3 (School of Evocation), sage background" },
    ...(rows.story.played.includes(YARD_SCENE) ? {} : { lead: { key: YARD_SCENE, title: YARD.title, hook: YARD.hook! } }),
    acts: rows.explore.acts, said: rows.explore.said, log: [...rows.explore.log],
    ...patch,
  };
}
