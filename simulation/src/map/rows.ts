import { getMap, useMaps } from "../../../shared/map/maps.ts";
import { keepColumns, keepFromColumns, type ExploreRow, type MapPlace, type MapRows } from "../../../shared/map/rows.ts";
import type { MapFile } from "../../../shared/map/tiles.ts";
import type { Unheard } from "../../../shared/map/town.ts";
import type { Tile2 } from "../../../shared/map/types.ts";
import { idText } from "../../../shared/protocol/keys.ts";
import type { TimeOfDay } from "../../../shared/scene/files.ts";
import type { TxCtx } from "../context.ts";
import type { GameRow, PlaceRow, RowOf, SceneRow } from "../rows.ts";
import { gameCampaignId, sceneDefOf, documentOf } from "../scenes.ts";
import { placeRows } from "../world/rows-io.ts";

/**
 * The maps' rows in the simulation (map-design §3.1, §3.4): what a move reads in its transaction to
 * make the prototype's ExploreState (shared/map/rows.ts exploreOf, the same rows a client reads, so
 * both offer the same ids), the walker's explore row back and forth, each map's own place, and the
 * seats following the host from place to place.
 */

export type ExploreTableRow = RowOf<"explore">;

/** The game's walker: its host's explore row, when the game is on a map. */
export const walkerOf = (tx: TxCtx, game: GameRow): ExploreTableRow | undefined => tx.db.explore.playerId.find(game.hostId) ?? undefined;

/** A map's own place (the town: map:caerwyn), by the map's key. */
export const mapPlaceKey = (mapKey: string) => `map:${mapKey}`;

/**
 * Everything the map is read from (MapRows), as this transaction sees it: the campaign's maps, the
 * walker's row, where the story is (the time of day, the lead, the scenes played), the game's places
 * on maps with their rows (never gm_note: the client can't read it, and both sides must offer the
 * same), and the cast the host hasn't heard named.
 */
export function mapRowsOf(tx: TxCtx, game: GameRow, walker: ExploreTableRow): MapRows {
  const scenes = [...tx.db.scene.gameId.filter(game.id)].sort((a, b) => (a.id < b.id ? -1 : 1));
  const places = [...tx.db.place.gameId.filter(game.id)].filter(p => p.mapKey !== undefined && p.active).sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    maps: mapFilesOf(tx, game),
    explore: exploreRowFrom(walker),
    story: { time: game.time as TimeOfDay, ...(game.leadScene ? { lead: game.leadScene } : {}), played: scenes.filter(s => s.status === "ended").map(s => s.sceneKey) },
    places: places.map(p => placeOnMap(tx, game, p, scenes)),
    unheard: unheardOf(tx, game, places),
  };
}

/** The game's maps (its campaign version's map_def rows), by key. */
export function mapFilesOf(tx: TxCtx, game: GameRow): MapFile[] {
  return [...tx.db.mapDef.campaignId.filter(gameCampaignId(game))].sort((a, b) => (a.key < b.key ? -1 : 1)).map(d => JSON.parse(d.json) as MapFile);
}

/** The explore row as the shared map code has it (ids as strings, empty options left out). */
export function exploreRowFrom(r: ExploreTableRow): ExploreRow {
  return {
    playerId: idText(r.playerId), gameId: idText(r.gameId), map: r.map, at: { ...r.at }, facing: { ...r.facing }, steps: r.steps, hidden: r.hidden,
    ...(r.scene !== undefined ? { scene: r.scene } : {}),
    followers: r.followers.map(f => ({ ...f, at: { ...f.at } })),
    quips: r.quips, ...(r.lastQuip !== undefined ? { lastQuip: r.lastQuip } : {}), styles: [...r.styles],
    acts: r.acts, said: r.said, log: [...r.log],
    ...keepFromColumns(r),
  };
}

/** The shared explore row written back as the table has it. */
export function writeExplore(tx: TxCtx, r: ExploreRow): void {
  const row: ExploreTableRow = {
    playerId: BigInt(r.playerId), gameId: BigInt(r.gameId), map: r.map, at: tile(r.at), facing: tile(r.facing), steps: r.steps, hidden: r.hidden,
    scene: r.scene, followers: r.followers.map(f => ({ ...f, at: tile(f.at) })), quips: r.quips, lastQuip: r.lastQuip, styles: r.styles,
    acts: r.acts, said: r.said, log: r.log,
    ...keepColumns(r),
  };
  if (tx.db.explore.playerId.find(row.playerId)) tx.db.explore.playerId.update(row);
  else tx.db.explore.insert(row);
}

/**
 * A map's own place in a game (map:caerwyn), made the first time anyone's on that map: the place the
 * seats are in while they're on it, with no world of its own yet (rootId 0, no entities: the town's
 * people and things are the map's, which presence.ts and its legend make from the time of day, on
 * both sides).
 */
export function mapPlaceOf(tx: TxCtx, game: GameRow, mapKey: string): PlaceRow {
  const key = mapPlaceKey(mapKey);
  const there = [...tx.db.place.gameId.filter(game.id)].find(p => p.key === key);
  if (there) return there;

  useMaps(mapFilesOf(tx, game));
  const map = getMap(mapKey);
  return tx.db.place.insert({
    id: 0n, gameId: game.id, key, name: map.name, rootId: 0n, sizeW: map.width * FEET_PER_TILE, sizeH: map.height * FEET_PER_TILE, round: 0, rev: 0,
    sceneId: undefined, mapKey, region: undefined, origin: { x: 0, y: 0 }, active: true, town: "", tickedAt: undefined,
  });
}

/**
 * Every seat of the game (the host's, each spectator's) in a place, and in a scene or none: the
 * seats follow the host, into a scene, back out onto the map, onto another map (the story's, in
 * world/cross.ts, which moves them between scenes the same way).
 */
export { moveSeats } from "../world/cross.ts";

/** Where a region's world sits on its map: its (0, 0) feet, in tiles (reconcile.ts feetToTile's). */
export const originOf = (region: { rect: { x: number; y: number }; worldOrigin?: Tile2 }): Tile2 => ({ ...(region.worldOrigin ?? { x: region.rect.x, y: region.rect.y }) });

// ---------------------------------------------------------------------------------------------

/** A place on a map as MapRows has it: its scene's key, status and time of day, and its rows but gm_note. */
function placeOnMap(tx: TxCtx, game: GameRow, place: PlaceRow, scenes: SceneRow[]): MapPlace {
  const scene = place.sceneId === undefined ? undefined : scenes.find(s => s.id === place.sceneId);
  return {
    key: place.key, mapKey: place.mapKey!, ...(place.region ? { region: place.region } : {}), origin: place.origin ?? { x: 0, y: 0 },
    ...(scene ? { scene: { key: scene.sceneKey, status: scene.status, time: timeOf(tx, game, scene) } } : {}),
    rows: { ...placeRows(tx, place.id), gmNote: [] },
    ...(place.town ? { town: place.town } : {}),
  };
}

/** The time of day a scene is played at: its own, or the story's. */
function timeOf(tx: TxCtx, game: GameRow, scene: SceneRow): TimeOfDay {
  return documentOf(sceneDefOf(tx, game, scene.sceneKey)).time ?? (game.time as TimeOfDay);
}

/**
 * The people in the places on the maps whose names the host hasn't heard, with what they'd call
 * them (asHeard's pairs): each cast member with a `called` and no heard row, once.
 */
function unheardOf(tx: TxCtx, game: GameRow, places: PlaceRow[]): Unheard {
  const heard = new Set([...tx.db.heard.playerId.filter(game.hostId)].map(h => h.entityKey));
  const unheard = new Map<string, { name: string; called: string }>();
  for (const place of places) {
    for (const e of [...tx.db.entity.placeId.filter(place.id)].sort((a, b) => a.ord - b.ord)) {
      if (e.called && !heard.has(e.key) && !unheard.has(e.key)) unheard.set(e.key, { name: e.name, called: e.called });
    }
  }
  return [...unheard.values()];
}

const FEET_PER_TILE = 5;

const tile = (t: Tile2): Tile2 => ({ x: t.x, y: t.y });
