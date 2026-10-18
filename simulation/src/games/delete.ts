import type { TxCtx } from "../context.ts";
import type { GameRow, PlaceRow, PlayerRow, SceneRow } from "../rows.ts";

/**
 * Every row of a game, deleted (v1-design §3.5): through a registry of the game's tables, a line a
 * table, which a vertical that adds a table extends. By the game itself, by each of its players,
 * scenes and places. A job of the game in flight finds no row at its commit, and is dropped. The AI
 * service's folder for the game stays, as the prototype keeps a deleted game's logs.
 */

/** A game's rows: what deleting its tables reads first. */
interface GameRows { game: GameRow; players: PlayerRow[]; scenes: SceneRow[]; places: PlaceRow[] }

/** The tables a game's rows are in by the game (append-only: a line a table). */
const BY_GAME: Array<(tx: TxCtx, rows: GameRows) => void> = [
  (tx, { game }) => tx.db.sheet.gameId.delete(game.id),
  (tx, { game }) => tx.db.rulesState.gameId.delete(game.id),
  (tx, { game }) => tx.db.dice.gameId.delete(game.id),
  (tx, { game }) => jobsOf(tx, game).forEach(job => deleteJob(tx, job.id)),
  (tx, { game }) => [...tx.db.creation.iter()].filter(c => c.gameId === game.id).forEach(c => tx.db.creation.identity.delete(c.identity)),
  (tx, { game }) => tx.db.explore.gameId.delete(game.id),
  (tx, { game }) => tx.db.chapter.gameId.delete(game.id),
  (tx, { game }) => tx.db.quest.gameId.delete(game.id),
  (tx, { game }) => tx.db.flag.gameId.delete(game.id),
  (tx, { game }) => tx.db.journal.gameId.delete(game.id),
  (tx, { game }) => tx.db.attitude.gameId.delete(game.id),
  (tx, { game }) => tx.db.follower.gameId.delete(game.id),
  (tx, { game }) => tx.db.game.id.delete(game.id),
];

/** By each of its players (append-only). */
const BY_PLAYER: Array<(tx: TxCtx, player: PlayerRow) => void> = [
  (tx, player) => [...tx.db.seat.iter()].filter(s => s.playerId === player.id).forEach(s => tx.db.seat.identity.delete(s.identity)),
  (tx, player) => tx.db.heard.playerId.delete(player.id),
  (tx, player) => tx.db.player.id.delete(player.id),
];

/** By each of its scenes (append-only). */
const BY_SCENE: Array<(tx: TxCtx, scene: SceneRow) => void> = [
  (tx, scene) => tx.db.gmState.sceneId.delete(scene.id),
  (tx, scene) => tx.db.onStage.sceneId.delete(scene.id),
  (tx, scene) => tx.db.replyDraft.sceneId.delete(scene.id),
  (tx, scene) => tx.db.turn.sceneId.delete(scene.id),
  (tx, scene) => tx.db.transcript.sceneId.delete(scene.id),
  (tx, scene) => tx.db.sceneSuggestion.sceneId.delete(scene.id),
  (tx, scene) => tx.db.scene.id.delete(scene.id),
];

/** By each of its places: the entities, every component, the log and the looks (append-only). */
const BY_PLACE: Array<(tx: TxCtx, place: PlaceRow) => void> = [
  (tx, place) => tx.db.position.placeId.delete(place.id),
  (tx, place) => tx.db.area.placeId.delete(place.id),
  (tx, place) => tx.db.material.placeId.delete(place.id),
  (tx, place) => tx.db.health.placeId.delete(place.id),
  (tx, place) => tx.db.stack.placeId.delete(place.id),
  (tx, place) => tx.db.surface.placeId.delete(place.id),
  (tx, place) => tx.db.creature.placeId.delete(place.id),
  (tx, place) => tx.db.playerCharacter.placeId.delete(place.id),
  (tx, place) => tx.db.gear.placeId.delete(place.id),
  (tx, place) => tx.db.narrative.placeId.delete(place.id),
  (tx, place) => tx.db.gmNote.placeId.delete(place.id),
  (tx, place) => tx.db.worldLog.placeId.delete(place.id),
  (tx, place) => tx.db.look.placeId.delete(place.id),
  (tx, place) => tx.db.entity.placeId.delete(place.id),
  (tx, place) => tx.db.place.id.delete(place.id),
];

/** Every row of the game, in every table the registry names. */
export function deleteGameRows(tx: TxCtx, game: GameRow): void {
  const rows = rowsOf(tx, game);

  for (const place of rows.places) BY_PLACE.forEach(line => line(tx, place));
  for (const scene of rows.scenes) BY_SCENE.forEach(line => line(tx, scene));
  for (const player of rows.players) BY_PLAYER.forEach(line => line(tx, player));
  BY_GAME.forEach(line => line(tx, rows));
  tx.log(`[game ${game.id} ${game.uid}] deleted: ${rows.players.length} players, ${rows.scenes.length} scenes, ${rows.places.length} places`);
}

// ---------------------------------------------------------------------------------------------

function rowsOf(tx: TxCtx, game: GameRow): GameRows {
  return {
    game,
    players: [...tx.db.player.gameId.filter(game.id)],
    scenes: [...tx.db.scene.gameId.filter(game.id)],
    places: [...tx.db.place.gameId.filter(game.id)],
  };
}

/** A game's jobs: a turn's has the game on its row (a creation's, before the game, has none). */
const jobsOf = (tx: TxCtx, game: GameRow) => [...tx.db.job.iter()].filter(j => j.gameId === game.id);

/** A job and the dispatches still waiting to run it. */
function deleteJob(tx: TxCtx, jobId: bigint): void {
  for (const d of [...tx.db.jobDispatch.iter()].filter(d => d.jobId === jobId)) tx.db.jobDispatch.scheduledId.delete(d.scheduledId);
  tx.db.job.id.delete(jobId);
}
