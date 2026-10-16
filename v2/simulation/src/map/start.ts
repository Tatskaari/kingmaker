import { initialGm } from "../../../shared/gm/state.ts";
import { useMaps } from "../../../shared/map/maps.ts";
import { regionForScene, scenePlace } from "../../../shared/map/places.ts";
import type { Tile2 } from "../../../shared/map/types.ts";
import type { TxCtx } from "../context.ts";
import { putGm } from "../gm/rows.ts";
import { placeKeyOf } from "../moves/open-scene.ts";
import { gameRow, placeRow, playerRow, type CampaignRow, type GameRow, type SceneRow } from "../rows.ts";
import { campaignFile, graphOf, sceneDefOf } from "../scenes.ts";
import { noteHeard } from "../transcript.ts";
import { waitingPlace } from "../world/place.ts";
import { mapFilesOf, mapPlaceOf, originOf } from "./rows.ts";

/**
 * The start on the map (map-design §3.3). When the campaign's start names a map (campaign.json's
 * start.map and start.at), new_game and begin put the host on it in place of opening the first
 * scene: the map's own place (map:caerwyn), the host's seat in it, their explore row on the start's
 * tile facing south (the prototype's newExploration), the lead (the first scene), and the lead's
 * place built on its map with its scene waiting. With no map, the first scene opens at once, as V1.
 */

/** The game set off on its campaign's start map, if it has one: true when it has. */
export function startOnMap(tx: TxCtx, game: GameRow, campaign: CampaignRow): boolean {
  const file = campaignFile(campaign);
  const mapKey = file.start.map;
  if (!mapKey) return false;

  useMaps(mapFilesOf(tx, game));
  const host = playerRow(tx, game.hostId);
  const town = mapPlaceOf(tx, game, mapKey);
  tx.db.game.id.update({ ...gameRow(tx, game.id), leadScene: file.firstScene });
  tx.db.explore.insert({
    playerId: host.id, gameId: game.id, map: mapKey, at: startTile(file.start.at), facing: { x: 0, y: 1 }, steps: 0, hidden: false, scene: undefined,
    followers: [], quips: 0, lastQuip: undefined, styles: [], acts: 0, said: "", log: [],
  });
  tx.db.player.id.update({ ...host, placeId: town.id, sceneId: undefined });

  buildLead(tx, gameRow(tx, game.id), file.firstScene);
  return true;
}

/**
 * The lead's place, built on its map, and its scene waiting (map-design §3.3; V3's boundary does
 * the same for the next lead): the place from its file with the cast present at the scene's start
 * and no one playing in it yet, in the map's region for the scene (its origin the region's world
 * origin); the scene's row `waiting`, with its GM bookkeeping as it starts, in that place. The
 * names the hook has given are heard. openLead opens it.
 */
export function buildLead(tx: TxCtx, game: GameRow, sceneKey: string): SceneRow {
  const def = sceneDefOf(tx, game, sceneKey);
  const graph = graphOf(def);
  const gm = initialGm(graph);
  const host = playerRow(tx, game.hostId);

  const { placeId } = waitingPlace(tx, game, placeKeyOf(tx, game, def), graph, gm, host);
  const scene = tx.db.scene.insert({
    id: 0n, gameId: game.id, sceneKey: def.key, title: def.title, hook: def.hook, kind: "scene", placeId,
    status: "waiting", controllerId: host.id, turnId: undefined, turns: 0, exitKey: undefined, rev: 0, openedAt: tx.now, endedAt: undefined,
  });
  putGm(tx, scene.id, gm);
  noteHeard(tx, scene, graph);

  const on = regionOf(tx, game, sceneKey);
  tx.db.place.id.update({
    ...placeRow(tx, placeId), sceneId: scene.id,
    mapKey: on?.map.id, region: on?.region.id, origin: on ? originOf(on.region) : undefined, active: !!on,
  });
  return scene;
}

/** The map and region a scene's place fills (places.ts), when the game's campaign has that map. */
function regionOf(tx: TxCtx, game: GameRow, sceneKey: string): ReturnType<typeof regionForScene> {
  const files = mapFilesOf(tx, game);
  useMaps(files);
  const place = scenePlace(sceneKey);
  return place && files.some(f => f.id === place.map) ? regionForScene(sceneKey) : undefined;
}

/** campaign.json's start.at as a tile; the prototype's lane by the granary gate when it has none. */
const startTile = (at: [number, number] | undefined): Tile2 => (at ? { x: at[0], y: at[1] } : { x: 42, y: 9 });
