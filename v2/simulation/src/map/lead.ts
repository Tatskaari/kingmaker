import { enterScene, type ExploreState } from "../../../shared/map/explore.ts";
import { usePlaces } from "../../../shared/map/places.ts";
import { exploreOf, exploreRowOf } from "../../../shared/map/rows.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { runMove, type Actor, type TxCtx } from "../context.ts";
import { startOf } from "../games/create.ts";
import { openScene, waitingScene } from "../moves/open-scene.ts";
import { gameRow, sceneRow, type GameRow } from "../rows.ts";
import { campaignOfGame, gameCampaignId } from "../scenes.ts";
import { mapRowsOf, moveSeats, walkerOf, writeExplore } from "./rows.ts";

/**
 * The one way into a scene (v2/docs/map-design.md §3.5): the lead's waiting scene (game.leadScene)
 * opened through V0's openScene, with what the character starts with on the game's first scene;
 * every seat of the game moved into it, and the explore row's scene and spot set (enterScene). The
 * map's triggers call it (a step into the yard, a word with Kell) in the same transaction as the
 * move, handing it the state they walked (`walked`), which the move then writes back; and so does
 * the whole story's Go on (V3: walk toward the lead where there's no map), with none, when the
 * explore row is read and written here.
 */
export function openLead(tx: TxCtx, actor: Actor, game: GameRow, walked?: ExploreState): void {
  const sceneKey = game.leadScene;
  if (!sceneKey) throw new Error(`game ${game.id} has no lead to open`);
  const first = [...tx.db.scene.gameId.filter(game.id)].every(s => s.status === "waiting");
  const waiting = waitingScene(tx, game.id, sceneKey);

  runMove(tx, openScene, actor, { game: game.id, sceneKey, ...(first ? { start: startOf(tx, campaignOfGame(tx, game), actor.id!) } : {}) });

  const scene = sceneRow(tx, waiting?.id ?? openedScene(tx, game, sceneKey));
  moveSeats(tx, game.id, scene.placeId, scene.id);
  enterOnMap(tx, gameRow(tx, game.id), sceneKey, walked);
}

/** The scene just opened, when it wasn't waiting (V0's insert): the newest of that key. */
function openedScene(tx: TxCtx, game: GameRow, sceneKey: string): bigint {
  const scene = [...tx.db.scene.gameId.filter(game.id)].filter(s => s.sceneKey === sceneKey).sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  if (!scene) throw new Error(`game ${game.id}'s scene ${sceneKey} didn't open`);
  return scene.id;
}

/**
 * The walker into the scene on the map (the prototype's town.enterScene): seen by whoever the scene
 * is with, standing where its place's world starts them, whoever walks with them come in too. The
 * state the move walked, or, with none, the explore row's, written back here.
 */
function enterOnMap(tx: TxCtx, game: GameRow, sceneKey: string, walked: ExploreState | undefined): void {
  const row = walkerOf(tx, game);
  if (!row) return;
  usePlaces(placeFilesOf(tx, game));
  const rows = walked ? undefined : mapRowsOf(tx, game, row);
  const ex = walked ?? exploreOf(rows!);

  delete ex.hidden;
  enterScene(ex, sceneKey);

  if (rows) writeExplore(tx, { ...exploreRowOf(ex, rows.explore, ""), acts: rows.explore.acts, said: rows.explore.said, log: rows.explore.log });
}

/** The game's campaign's place files (place_def rows), for sceneStart. */
function placeFilesOf(tx: TxCtx, game: GameRow): PlaceFile[] {
  return [...tx.db.placeDef.campaignId.filter(gameCampaignId(game))].map(d => JSON.parse(d.json) as PlaceFile);
}
