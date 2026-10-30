import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import { comesToPlayer } from "../../../shared/scene/beats.ts";
import { useMaps } from "../../../shared/map/maps.ts";
import { regionForScene, scenePlace } from "../../../shared/map/places.ts";
import type { Tile2 } from "../../../shared/map/types.ts";
import type { TxCtx } from "../context.ts";
import { putGm } from "../gm/rows.ts";
import { placeKeyOf } from "../moves/open-scene.ts";
import { gameRow, placeRow, playerRow, type CampaignRow, type GameRow, type SceneRow } from "../rows.ts";
import { campaignFile, graphOf, sceneDefOf } from "../scenes.ts";
import { noteHeard } from "../transcript.ts";
import { applyOnStart } from "../story/effects.ts";
import { rekeyOwed } from "../world/cross.ts";
import { waitingPlace } from "../world/place.ts";
import { mapFilesOf, mapPlaceOf, originOf } from "./rows.ts";
import { openLead } from "./lead.ts";
import { keepTicking } from "./tick.ts";

/**
 * The start on the map (map-design §3.3). When the campaign's start names a map (its scenario's
 * start.map and start.at), new_game and begin put the host on it in place of opening the first
 * scene: the map's own place (map:caerwyn), the host's seat in it, their explore row on the start's
 * tile facing south (the prototype's newExploration), the lead (the first scene), and the lead's
 * place built on its map with its scene waiting; a first scene that comes to the player (docs/scene-format.md
 * `summons`) opens there and then. With no map, the first scene opens at once, as V1.
 */

/** The game set off on its campaign's start map, if it has one: true when it has. */
export function startOnMap(tx: TxCtx, game: GameRow, campaign: CampaignRow): boolean {
  const file = campaignFile(campaign);
  const mapKey = file.start.map;
  if (!mapKey) return false;

  tx.db.game.id.update({ ...gameRow(tx, game.id), leadScene: file.firstScene });
  putOnMap(tx, game, mapKey, startTile(file.start.at));

  buildLead(tx, gameRow(tx, game.id), file.firstScene);
  // A first scene that comes to the player (the King's Road: on the cart as the game begins) opens at once, where it's played.
  if (comesToPlayer(graphOf(sceneDefOf(tx, game, file.firstScene)))) {
    const host = playerRow(tx, game.hostId);
    openLead(tx, { identity: host.identity, id: host.id }, gameRow(tx, game.id));
  }
  return true;
}

/**
 * The game's host on one of its campaign's maps, at a tile facing south (the prototype's
 * newExploration): their explore row, the map's own place their seat's, its clock ticking. The story's
 * start (startOnMap) leads somewhere from there; a zoo visit (zoo/visit.ts) has no lead.
 */
export function putOnMap(tx: TxCtx, game: GameRow, mapKey: string, at: Tile2): void {
  useMaps(mapFilesOf(tx, game));
  const host = playerRow(tx, game.hostId);
  const town = mapPlaceOf(tx, game, mapKey);
  tx.db.explore.insert({
    playerId: host.id, gameId: game.id, map: mapKey, at: { ...at }, facing: { x: 0, y: 1 }, steps: 0, hidden: false, scene: undefined,
    followers: [], quips: 0, lastQuip: undefined, styles: [], acts: 0, said: "", log: [],
    rested: undefined, spotted: undefined, lifted: undefined, fight: undefined,
  });
  tx.db.player.id.update({ ...host, placeId: town.id, sceneId: undefined });
  keepTicking(tx, town.id);
}

/**
 * The lead's place built and its scene waiting (map-design §3.3; story-design §4.3, the boundary's
 * commit): the place from its file with the cast present at the scene's start and no one playing in
 * it yet (the absent left out; those of the cast already in the game moved in, with what the story
 * still owes the player that they hold); the scene's row `waiting`, at its time of day, with its GM
 * bookkeeping as it starts and what was handed on (`handed`: the adjustments, the opening rewritten,
 * the lead, who's absent, what's owed; none for the game's first lead), in that place, filling its
 * region of its map when the game's campaign has that map. The names the hook has given are heard,
 * and the scene comes into the story: its onStart (story/effects.ts applyOnStart: the game's first
 * lead starts its quest as the game begins). openLead opens it.
 */
export function buildLead(tx: TxCtx, game: GameRow, sceneKey: string, handed?: GmState): SceneRow {
  const def = sceneDefOf(tx, game, sceneKey);
  const gm = handed ?? initialGm(graphOf(def));
  const graph = graphOf(def, gm.patches);
  const host = playerRow(tx, game.hostId);

  const { placeId, renamed, owed } = waitingPlace(tx, game, placeKeyOf(tx, game, def), graph, gm, host);
  const scene = tx.db.scene.insert({
    id: 0n, gameId: game.id, sceneKey: def.key, title: def.title, hook: def.hook, kind: "scene", placeId,
    status: "waiting", controllerId: host.id, turnId: undefined, turns: 0, exitKey: undefined, rev: 0, openedAt: tx.now, endedAt: undefined,
    time: graph.time,
  });
  putGm(tx, scene.id, { ...gm, owed: rekeyOwed(gm.owed, renamed) });
  noteHeard(tx, scene, graph);

  const on = regionOf(tx, game, sceneKey);
  tx.db.place.id.update({
    ...placeRow(tx, placeId), sceneId: scene.id,
    mapKey: on?.map.id, region: on?.region.id, origin: on ? originOf(on.region) : undefined, active: !!on,
  });
  if (owed.length) tx.log(`[story] ${sceneKey} waits with what's owed: ${owed.join(", ")}`);
  applyOnStart(tx, { scene, graph, gm });
  return scene;
}

/** The map and region a scene's place fills (places.ts), when the game's campaign has that map. */
function regionOf(tx: TxCtx, game: GameRow, sceneKey: string): ReturnType<typeof regionForScene> {
  const files = mapFilesOf(tx, game);
  useMaps(files);
  const place = scenePlace(sceneKey);
  return place && files.some(f => f.id === place.map) ? regionForScene(sceneKey) : undefined;
}

/** The scenario's start.at as a tile; the prototype's lane by the granary gate when it has none. */
const startTile = (at: [number, number] | undefined): Tile2 => (at ? { x: at[0], y: at[1] } : { x: 42, y: 9 });
